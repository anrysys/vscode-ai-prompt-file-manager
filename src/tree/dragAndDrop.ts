import * as path from 'node:path';
import * as vscode from 'vscode';
import { FILES_MIME_TYPE, TREE_MIME_TYPE, URI_LIST_MIME_TYPE } from '../constants';
import { getFileExtensions } from '../config/configuration';
import { findRootFor } from '../config/roots';
import { transfer, type TransferResult, type UsageMigrator } from '../fs/transfer';
import type { PlacementRejected } from '../fs/boundary';
import type { SnippetRepository } from '../fs/repository';
import type { SnippetRoot } from '../model/snippet';
import { targetDirectoryOf, type PromptNode } from './nodes';

/**
 * Drag and drop for the prompt tree.
 *
 * A separate class rather than another hat on PromptTreeProvider: the provider is
 * deliberately stateless and depends on exactly one thing, the repository. Dropping needs
 * the usage tracker and the mutation pipeline, and folding those into the read path would
 * cost the provider its isolation for no benefit. `onChanged` is a plain callback for the
 * same reason WatcherManager takes one -- so `tree/` never imports `commands/`.
 *
 * There is no copy-on-drag: the API exposes no modifier-key state, so Ctrl-drag cannot be
 * detected. Copying is reachable through Copy/Paste and Duplicate instead.
 */
export class PromptDragAndDropController implements vscode.TreeDragAndDropController<PromptNode> {
    readonly dragMimeTypes = [URI_LIST_MIME_TYPE];
    readonly dropMimeTypes = [TREE_MIME_TYPE, URI_LIST_MIME_TYPE, FILES_MIME_TYPE];

    constructor(
        private readonly repo: SnippetRepository,
        private readonly usage: UsageMigrator,
        private readonly onChanged: () => void,
        private readonly notify: (result: TransferResult) => void,
    ) {}

    handleDrag(source: readonly PromptNode[], dataTransfer: vscode.DataTransfer): void {
        // A configured root is a setting, not a resource: it cannot be dragged anywhere.
        const draggable = source.filter(
            (node): node is Exclude<PromptNode, { type: 'root' }> => node.type !== 'root',
        );
        if (draggable.length === 0) {
            return;
        }
        const uris = draggable.map((node) => node.entry.uri.toString());

        // Plain strings, not the node objects. DataTransferItem.value is typed `any` and
        // has to be validated on the way out regardless, and a structural payload keeps
        // working if the host ever serialises the transfer.
        dataTransfer.set(TREE_MIME_TYPE, new vscode.DataTransferItem({ uris }));
        // Lets a prompt be dragged straight into an editor. \r\n is what the API specifies.
        dataTransfer.set(URI_LIST_MIME_TYPE, new vscode.DataTransferItem(uris.join('\r\n')));
    }

    async handleDrop(
        target: PromptNode | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<void> {
        try {
            await this.drop(target, dataTransfer, token);
        } catch (err) {
            // handleDrop is called by VS Code, not the command dispatcher, so an unhandled
            // rejection would disappear into the log with nothing shown to the user.
            const message = err instanceof Error ? err.message : String(err);
            void vscode.window.showErrorMessage(`Could not complete the drop: ${message}`);
        }
    }

    private async drop(
        target: PromptNode | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const roots = this.repo.getRoots();
        const targetDir = dropDirectoryFor(target, roots);
        if (!targetDir) {
            void vscode.window.showWarningMessage('Drop onto a specific prompts folder.');
            return;
        }

        const internal = readTreeUris(dataTransfer);
        if (internal.length > 0) {
            await this.run(internal, targetDir, 'move', roots, token);
            return;
        }

        const external = readUriList(dataTransfer);
        if (external.length > 0) {
            // Anything already inside a root is a move; anything from outside is an import,
            // which always copies -- taking a file out of someone's project would be
            // destructive and unrecoverable.
            const inside = external.filter((uri) => findRootFor(uri, roots) !== undefined);
            const outside = external.filter((uri) => findRootFor(uri, roots) === undefined);

            if (inside.length > 0) {
                await this.run(inside, targetDir, 'move', roots, token);
            }
            if (outside.length > 0) {
                const { allowed, skipped } = splitBySupportedType(outside);
                await this.run(allowed, targetDir, 'import', roots, token, skipped);
            }
            return;
        }

        // Last resort: a drop carrying raw bytes and no path of its own, as on web.
        await this.importDroppedFiles(dataTransfer, targetDir, token);
    }

    /**
     * Writes files that arrived as content rather than as paths. These land directly in
     * the target, so they never reach `transfer` -- there is nothing left to move.
     */
    private async importDroppedFiles(
        dataTransfer: vscode.DataTransfer,
        targetDir: vscode.Uri,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const extensions = getFileExtensions();
        const succeeded: { from: vscode.Uri; to: vscode.Uri; renamed: boolean }[] = [];
        const rejected: PlacementRejected[] = [];
        const failed: { source: vscode.Uri; error: unknown }[] = [];

        for (const [, item] of dataTransfer) {
            if (token.isCancellationRequested) {
                break;
            }
            const file = item.asFile();
            if (!file) {
                continue;
            }
            const placeholder = file.uri ?? vscode.Uri.file(file.name);
            if (!extensions.some((ext) => file.name.toLowerCase().endsWith(ext))) {
                rejected.push({
                    ok: false,
                    source: placeholder,
                    reason: 'unsupportedType',
                    message: `"${file.name}" was skipped — only ${extensions.join(', ')} files are prompts.`,
                });
                continue;
            }
            try {
                const bytes = await file.data();
                const written = await this.repo.writeNewFile(targetDir, file.name, bytes);
                succeeded.push({ from: placeholder, to: written, renamed: false });
            } catch (error) {
                failed.push({ source: placeholder, error });
            }
        }

        if (succeeded.length === 0 && rejected.length === 0 && failed.length === 0) {
            return;
        }
        this.onChanged();
        this.notify({ operation: 'import', targetDir, succeeded, rejected, failed });
    }

    private async run(
        sources: readonly vscode.Uri[],
        targetDir: vscode.Uri,
        operation: 'move' | 'import',
        roots: readonly SnippetRoot[],
        token: vscode.CancellationToken,
        extraRejections: readonly PlacementRejected[] = [],
    ): Promise<TransferResult> {
        const result = await transfer(
            this.repo,
            this.usage,
            { sources, targetDir, operation, roots },
            token,
        );
        const merged: TransferResult = {
            ...result,
            rejected: [...result.rejected, ...extraRejections],
        };
        this.onChanged();
        this.notify(merged);
        return merged;
    }

}

/** A file is not a container: dropping onto one means the folder it lives in. */
export function dropDirectoryFor(
    node: PromptNode | undefined,
    roots: readonly SnippetRoot[],
): vscode.Uri | undefined {
    if (!node) {
        return roots.length === 1 ? roots[0]?.uri : undefined;
    }
    if (node.type === 'file') {
        return vscode.Uri.joinPath(node.entry.uri, '..');
    }
    return targetDirectoryOf(node);
}

/**
 * Reads our own drag payload. Structural, never a cast or an instanceof: the value is
 * typed `any`, so a malformed one must be a no-op rather than a crash.
 */
export function readTreeUris(dataTransfer: vscode.DataTransfer): vscode.Uri[] {
    const value: unknown = dataTransfer.get(TREE_MIME_TYPE)?.value;
    if (typeof value !== 'object' || value === null || !('uris' in value)) {
        return [];
    }
    const raw = (value as { uris: unknown }).uris;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => vscode.Uri.parse(entry));
}

/** `text/uri-list` is newline separated, and comment lines start with '#'. */
export function readUriList(dataTransfer: vscode.DataTransfer): vscode.Uri[] {
    const value: unknown = dataTransfer.get(URI_LIST_MIME_TYPE)?.value;
    if (typeof value !== 'string') {
        return [];
    }
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => vscode.Uri.parse(line));
}

/**
 * Keeps only what this extension can actually show. A dropped .png would land on disk and
 * then be invisible in the tree, which reads as the drop having silently failed.
 */
export function splitBySupportedType(uris: readonly vscode.Uri[]): {
    allowed: vscode.Uri[];
    skipped: PlacementRejected[];
} {
    const extensions = getFileExtensions();
    const allowed: vscode.Uri[] = [];
    const skipped: PlacementRejected[] = [];

    for (const uri of uris) {
        const name = path.basename(uri.fsPath);
        // A name with no extension is taken to be a folder and copied wholesale.
        const isFolder = path.extname(name) === '';
        if (isFolder || extensions.some((ext) => name.toLowerCase().endsWith(ext))) {
            allowed.push(uri);
            continue;
        }
        skipped.push({
            ok: false,
            source: uri,
            reason: 'unsupportedType',
            message: `"${name}" was skipped — only ${extensions.join(', ')} files are prompts.`,
        });
    }
    return { allowed, skipped };
}
