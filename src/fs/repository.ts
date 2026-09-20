import * as path from 'node:path';
import * as vscode from 'vscode';
import { MAX_SCAN_ENTRIES } from '../constants';
import { log } from '../log';
import { resolveRoots } from '../config/roots';
import {
    getExcludeGlobs,
    getFileExtensions,
    getMaxDepth,
    getMaxFileSizeBytes,
} from '../config/configuration';
import type { SnippetEntry, SnippetFile, SnippetFolder, SnippetRoot } from '../model/snippet';
import { labelFromFileName, uriKey } from './paths';

const BOM = '\uFEFF';

/** Errors that mean the request itself was invalid, rather than the provider failing. */
const SEMANTIC_FS_CODES = new Set(['FileExists', 'FileNotFound', 'NoPermissions', 'FileIsADirectory', 'FileNotADirectory']);

export class SnippetTooLargeError extends Error {
    constructor(
        readonly uri: vscode.Uri,
        readonly size: number,
        readonly limit: number,
    ) {
        super(`${path.basename(uri.fsPath)} is larger than the configured limit.`);
        this.name = 'SnippetTooLargeError';
    }
}

function isFileNotFound(err: unknown): boolean {
    return err instanceof vscode.FileSystemError && err.code === 'FileNotFound';
}

/** Translates a glob to a RegExp good enough for the simple patterns used in excludeGlobs. */
function globToRegExp(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, ' SLASHSTAR ')
        .replace(/\*\*/g, ' DOUBLESTAR ')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/ SLASHSTAR /g, '(?:.*/)?')
        .replace(/ DOUBLESTAR /g, '.*');
    return new RegExp(`^${escaped}$`);
}

export class SnippetRepository {
    /** Directories already reported as unreadable, so the log is not spammed on every refresh. */
    private readonly warnedPaths = new Set<string>();

    constructor(private readonly context: vscode.ExtensionContext) {}

    getRoots(): SnippetRoot[] {
        return resolveRoots(this.context);
    }

    async exists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    /** Throws FileNotFound when the resource is gone, which callers rely on. */
    async statOf(uri: vscode.Uri): Promise<vscode.FileStat> {
        return vscode.workspace.fs.stat(uri);
    }

    async isDirectory(uri: vscode.Uri): Promise<boolean> {
        const stat = await this.statOf(uri);
        return (stat.type & vscode.FileType.Directory) !== 0;
    }

    /**
     * One directory level, folders first then files, each sorted naturally.
     * A missing directory is an empty scope rather than an error.
     */
    async listChildren(dir: vscode.Uri, root: SnippetRoot): Promise<SnippetEntry[]> {
        const extensions = getFileExtensions();
        const excludes = getExcludeGlobs().map(globToRegExp);

        let raw: [string, vscode.FileType][];
        try {
            raw = await vscode.workspace.fs.readDirectory(dir);
        } catch (err) {
            this.warnUnreadable(dir, err);
            return [];
        }

        const folders: SnippetFolder[] = [];
        const files: SnippetFile[] = [];

        for (const [name, type] of raw) {
            if (name.startsWith('.')) {
                continue;
            }
            const uri = vscode.Uri.joinPath(dir, name);
            const relativePath = this.relativeTo(root, uri);
            if (relativePath === undefined) {
                continue;
            }
            if (excludes.some((re) => re.test(relativePath))) {
                continue;
            }

            const isDirectory = (type & vscode.FileType.Directory) !== 0;
            if (isDirectory) {
                folders.push({
                    kind: 'folder',
                    uri,
                    name,
                    label: name,
                    root,
                    relativePath,
                });
                continue;
            }

            const isFile = (type & vscode.FileType.File) !== 0;
            if (!isFile) {
                continue;
            }
            if (!extensions.some((ext) => name.toLowerCase().endsWith(ext))) {
                continue;
            }
            const stat = await this.safeStat(uri);
            files.push({
                kind: 'file',
                uri,
                name,
                label: labelFromFileName(name, extensions),
                root,
                relativePath,
                size: stat?.size ?? 0,
                mtime: stat?.mtime ?? 0,
            });
        }

        folders.sort(byName);
        files.sort(byName);
        return [...folders, ...files];
    }

    /**
     * Every snippet file under a root. Used only by the Quick Pick.
     *
     * Deliberately not `workspace.findFiles`, which returns nothing for directories
     * outside the workspace -- and the global root usually is outside it.
     */
    async listFilesRecursive(
        root: SnippetRoot,
        token?: vscode.CancellationToken,
    ): Promise<SnippetFile[]> {
        const maxDepth = getMaxDepth();
        const results: SnippetFile[] = [];
        const visited = new Set<string>([uriKey(root.uri)]);
        let queue: { uri: vscode.Uri; depth: number }[] = [{ uri: root.uri, depth: 0 }];

        while (queue.length > 0) {
            if (token?.isCancellationRequested) {
                return results;
            }
            const next: typeof queue = [];
            for (const { uri, depth } of queue) {
                const children = await this.listChildren(uri, root);
                for (const child of children) {
                    if (child.kind === 'file') {
                        results.push(child);
                        if (results.length >= MAX_SCAN_ENTRIES) {
                            log.warn(
                                `Stopped scanning "${root.label}" at ${MAX_SCAN_ENTRIES} snippets. Narrow promptManager.excludeGlobs or lower promptManager.maxDepth.`,
                            );
                            return results;
                        }
                        continue;
                    }
                    if (depth + 1 > maxDepth) {
                        continue;
                    }
                    // Guards against symlink cycles, which readDirectory happily follows.
                    const key = uriKey(child.uri);
                    if (visited.has(key)) {
                        continue;
                    }
                    visited.add(key);
                    next.push({ uri: child.uri, depth: depth + 1 });
                }
            }
            queue = next;
        }
        return results;
    }

    /**
     * Reads a snippet body straight from disk, every time. Nothing is cached anywhere,
     * so what gets inserted is always exactly what is on disk right now.
     */
    async readSnippet(uri: vscode.Uri): Promise<string> {
        const limit = getMaxFileSizeBytes();
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > limit) {
            throw new SnippetTooLargeError(uri, stat.size, limit);
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = new TextDecoder('utf-8').decode(bytes);
        // A leading BOM is invisible in the editor but corrupts a pasted prompt.
        return text.startsWith(BOM) ? text.slice(1) : text;
    }

    /** createDirectory is recursive and idempotent, so no existence check is needed. */
    async ensureDirectory(uri: vscode.Uri): Promise<void> {
        await vscode.workspace.fs.createDirectory(uri);
    }

    /**
     * First free name in `dir` for `name`, suffixing `-2`, `-3`... rather than ever
     * overwriting. Returns the Uri that is safe to write to.
     *
     * `keepExtension` is false for directories, where a dot is part of the name rather
     * than an extension: `my.folder` must become `my.folder-2`, not `my-2.folder`.
     */
    async findFreeUri(
        dir: vscode.Uri,
        name: string,
        options: { keepExtension: boolean },
    ): Promise<vscode.Uri> {
        const ext = options.keepExtension ? path.extname(name) : '';
        const stem = ext.length > 0 ? name.slice(0, -ext.length) : name;

        for (let attempt = 1; attempt <= 100; attempt++) {
            const candidate = attempt === 1 ? name : `${stem}-${attempt}${ext}`;
            const uri = vscode.Uri.joinPath(dir, candidate);
            if (!(await this.exists(uri))) {
                return uri;
            }
        }
        throw new Error(`Could not find a free file name for "${name}" in ${dir.fsPath}.`);
    }

    /**
     * Creates a snippet, suffixing `-2`, `-3`... rather than ever overwriting an
     * existing file. Returns the Uri actually created.
     */
    async createSnippet(
        dir: vscode.Uri,
        fileName: string,
        initialContent: string,
    ): Promise<vscode.Uri> {
        await this.ensureDirectory(dir);
        const uri = await this.findFreeUri(dir, fileName, { keepExtension: true });
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(initialContent));
        return uri;
    }

    /**
     * Writes bytes under a free name in `dir`. Used for files dropped in from outside,
     * which may arrive as raw content with no path of their own.
     */
    async writeNewFile(
        dir: vscode.Uri,
        name: string,
        bytes: Uint8Array,
    ): Promise<vscode.Uri> {
        await this.ensureDirectory(dir);
        const uri = await this.findFreeUri(dir, name, { keepExtension: true });
        await vscode.workspace.fs.writeFile(uri, bytes);
        return uri;
    }

    async createFolder(parent: vscode.Uri, name: string): Promise<vscode.Uri> {
        const uri = vscode.Uri.joinPath(parent, name);
        if (await this.exists(uri)) {
            throw new Error(`"${name}" already exists.`);
        }
        await this.ensureDirectory(uri);
        return uri;
    }

    async rename(uri: vscode.Uri, newName: string): Promise<vscode.Uri> {
        const target = vscode.Uri.joinPath(uri, '..', newName);
        // Belt and braces. joinPath normalises '..', so a newName like '../../evil.md'
        // would land outside the root entirely. The command layer rejects separators
        // before we get here, but the repository must not depend on its callers.
        if (path.dirname(target.fsPath) !== path.dirname(uri.fsPath)) {
            throw new Error(`"${newName}" is not a valid name.`);
        }
        await vscode.workspace.fs.rename(uri, target, { overwrite: false });
        return target;
    }

    async copy(
        source: vscode.Uri,
        target: vscode.Uri,
        options: { overwrite: boolean },
    ): Promise<void> {
        // Recursive for directories already -- no manual walk needed.
        await vscode.workspace.fs.copy(source, target, options);
    }

    /**
     * Moves a resource, falling back to copy+delete when the provider cannot rename
     * across devices. The global root routinely lives on a different volume from the
     * workspace, so a bare rename is not enough.
     */
    async move(
        source: vscode.Uri,
        target: vscode.Uri,
        options: { overwrite: boolean },
    ): Promise<void> {
        try {
            await vscode.workspace.fs.rename(source, target, options);
            return;
        } catch (err) {
            // Semantic failures mean the caller asked for something impossible; only a
            // mechanical failure (a cross-device link, typically) is worth retrying.
            if (err instanceof vscode.FileSystemError && SEMANTIC_FS_CODES.has(err.code)) {
                throw err;
            }
            await vscode.workspace.fs.copy(source, target, options);
            // useTrash: false on purpose. The copy already exists, so trashing the
            // original would leave the user a confusing duplicate to clean up.
            await vscode.workspace.fs.delete(source, { recursive: true, useTrash: false });
        }
    }

    /** useTrash keeps deletions recoverable from the OS trash. */
    async delete(uri: vscode.Uri, recursive: boolean): Promise<void> {
        await vscode.workspace.fs.delete(uri, { recursive, useTrash: true });
    }

    private relativeTo(root: SnippetRoot, uri: vscode.Uri): string | undefined {
        const rel = path.relative(root.uri.fsPath, uri.fsPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            return undefined;
        }
        return rel.split(path.sep).join('/');
    }

    private async safeStat(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
        try {
            return await vscode.workspace.fs.stat(uri);
        } catch {
            return undefined;
        }
    }

    private warnUnreadable(dir: vscode.Uri, err: unknown): void {
        if (isFileNotFound(err)) {
            // A prompt directory that does not exist yet is an empty scope, not a failure.
            return;
        }
        const key = uriKey(dir);
        if (this.warnedPaths.has(key)) {
            return;
        }
        this.warnedPaths.add(key);
        log.warn(`Cannot read ${dir.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function byName(a: SnippetEntry, b: SnippetEntry): number {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}
