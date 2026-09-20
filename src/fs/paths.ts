import * as path from 'node:path';
import * as vscode from 'vscode';
import { SNIPPET_EXTENSIONS } from '../constants';

export interface ExpandContext {
    readonly homeDir: string;
    /** fsPath of the workspace folder the setting was read for, when there is one. */
    readonly workspaceFolder?: string;
    readonly env?: NodeJS.ProcessEnv;
}

const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

/** Characters that are illegal in a file name on at least one supported platform. */
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Expands `~`, `${userHome}`, `${workspaceFolder}` and `${env:NAME}`.
 * Unknown `${...}` tokens are left untouched so a typo is visible rather than silently blank.
 */
export function expandPathTemplate(raw: string, ctx: ExpandContext): string {
    let result = raw.trim();
    if (result.length === 0) {
        return '';
    }

    if (result === '~') {
        result = ctx.homeDir;
    } else if (result.startsWith('~/') || result.startsWith('~\\')) {
        result = path.join(ctx.homeDir, result.slice(2));
    }

    const env = ctx.env ?? process.env;
    return result.replace(/\$\{(userHome|workspaceFolder|env:[^}]+)\}/g, (match, token: string) => {
        if (token === 'userHome') {
            return ctx.homeDir;
        }
        if (token === 'workspaceFolder') {
            return ctx.workspaceFolder ?? match;
        }
        const name = token.slice('env:'.length);
        return env[name] ?? '';
    });
}

/**
 * Resolves a configured path to an absolute Uri. A relative value resolves against
 * `base` when given, otherwise against the home directory. Empty input yields undefined.
 */
export function resolveToUri(
    raw: string,
    base: vscode.Uri | undefined,
    ctx: ExpandContext,
): vscode.Uri | undefined {
    const expanded = expandPathTemplate(raw, ctx);
    if (expanded.length === 0) {
        return undefined;
    }
    if (path.isAbsolute(expanded)) {
        // Uri.file, never Uri.parse: Uri.parse('C:\\x') would yield a 'c:' scheme.
        return vscode.Uri.file(path.resolve(expanded));
    }
    if (base) {
        return vscode.Uri.joinPath(base, ...expanded.split(/[\\/]+/).filter(Boolean));
    }
    return vscode.Uri.file(path.resolve(ctx.homeDir, expanded));
}

/** POSIX-normalised path from `root` to `child`, or undefined when `child` is not inside `root`. */
export function relativePosix(root: vscode.Uri, child: vscode.Uri): string | undefined {
    const rel = path.relative(root.fsPath, child.fsPath);
    if (rel.length === 0) {
        return '';
    }
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return undefined;
    }
    return rel.split(path.sep).join('/');
}

/**
 * Comparison key for deduplication. Uses fsPath so that `file:///a/b` and `file:///a/b/`
 * collapse, and lower-cases only on case-insensitive platforms.
 */
export function uriKey(uri: vscode.Uri): string {
    const normalized = path.normalize(uri.fsPath).replace(/[\\/]+$/, '');
    return CASE_INSENSITIVE_FS ? normalized.toLowerCase() : normalized;
}

/**
 * True when `key` is `prefix` itself or sits beneath it. Both arguments must come from
 * `uriKey`, which has already normalised separators and stripped trailing ones -- that is
 * what makes testing a single `path.sep` sufficient here.
 *
 * Containment used to be reimplemented in three places (usage pruning, root lookup, tree
 * search), and the copies disagreed about separators. This is the one definition.
 */
export function isKeyUnder(key: string, prefix: string): boolean {
    return key === prefix || key.startsWith(prefix + path.sep);
}

export function isSameUri(a: vscode.Uri, b: vscode.Uri): boolean {
    return uriKey(a) === uriKey(b);
}

/** True when `child` is `ancestor` or lives anywhere beneath it. */
export function isUriUnder(child: vscode.Uri, ancestor: vscode.Uri): boolean {
    return isKeyUnder(uriKey(child), uriKey(ancestor));
}

/**
 * Removes a known snippet extension, leaving the rest of the name untouched.
 *
 * A name that is nothing but an extension is returned as-is rather than collapsing to an
 * empty string.
 */
export function stripSnippetExtension(
    name: string,
    knownExtensions: readonly string[],
): string {
    const lower = name.toLowerCase();
    for (const ext of knownExtensions) {
        if (name.length > ext.length && lower.endsWith(ext.toLowerCase())) {
            return name.slice(0, name.length - ext.length);
        }
    }
    return name;
}

/**
 * Display title for a snippet: 'code-review_v2.md' becomes 'code review v2'.
 *
 * Dashes and underscores become spaces because file names cannot contain the spaces a
 * readable title wants. This is presentation only -- the file on disk is never renamed,
 * and nothing else derives a path from this value.
 */
export function labelFromFileName(name: string, knownExtensions: readonly string[]): string {
    const stem = stripSnippetExtension(name, knownExtensions);
    const pretty = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return pretty.length > 0 ? pretty : name;
}

/**
 * Turns a user-supplied title into a safe file name stem.
 * Returns an empty string when nothing usable remains; callers must treat that as invalid.
 * `.` and `..` are rejected outright so a title can never escape its root.
 */
export function slugifyTitle(title: string): string {
    const cleaned = title
        .replace(ILLEGAL_NAME_CHARS, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/ /g, '-')
        .replace(/-+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '');
    if (cleaned === '' || cleaned === '.' || cleaned === '..') {
        return '';
    }
    return cleaned;
}

/**
 * Splits a user-supplied title into slugified path segments, treating `/` and `\` as
 * folder separators. Returns undefined when any segment is unusable.
 */
export function slugifyTitlePath(title: string): string[] | undefined {
    const rawSegments = title.split(/[\\/]+/).filter((s) => s.trim().length > 0);
    if (rawSegments.length === 0) {
        return undefined;
    }
    const segments: string[] = [];
    for (const raw of rawSegments) {
        const slug = slugifyTitle(raw);
        if (slug === '') {
            return undefined;
        }
        segments.push(slug);
    }
    return segments;
}

/**
 * Ensures `name` carries one of `extensions`, appending `fallback` when it does not.
 * `fallback` is always treated as an accepted extension, so this can never double it up.
 */
export function ensureExtension(
    name: string,
    extensions: readonly string[],
    fallback: string,
): string {
    const lower = name.toLowerCase();
    const accepted = [...extensions, fallback];
    if (accepted.some((ext) => ext.length > 0 && lower.endsWith(ext.toLowerCase()))) {
        return name;
    }
    return `${name}${fallback}`;
}

/**
 * File name for a newly created snippet.
 *
 * A title the user already typed an extension onto is used as-is. The check covers the
 * built-in formats as well as the configured ones, because a narrowed
 * `promptManager.fileExtensions` would otherwise turn "notes.md" into "notes.md.md".
 */
export function snippetFileName(
    stem: string,
    configuredExtensions: readonly string[],
    newExtension: string,
): string {
    return ensureExtension(stem, [...configuredExtensions, ...SNIPPET_EXTENSIONS], newExtension);
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
