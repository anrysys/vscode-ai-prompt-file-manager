import { uriKey } from '../fs/paths';
import type { SnippetFile, SnippetRoot } from '../model/snippet';

/**
 * Workspace roots first: they are the more specific scope, so they are the more likely
 * pick. Global is always last and therefore always in a predictable place.
 */
export function orderRootsForPicker(roots: readonly SnippetRoot[]): SnippetRoot[] {
    return [
        ...roots.filter((root) => root.scope === 'workspace'),
        ...roots.filter((root) => root.scope === 'global'),
    ];
}

export function compareByRelativePath(a: SnippetFile, b: SnippetFile): number {
    return a.relativePath.localeCompare(b.relativePath, undefined, {
        numeric: true,
        sensitivity: 'base',
    });
}

/**
 * Drops files already seen, which happens when one root is nested inside another.
 * Deduplication is by path only: two files with the same *name* in different scopes are
 * genuinely different snippets and must both survive.
 */
export function dedupeByPath(files: readonly SnippetFile[], seen: Set<string>): SnippetFile[] {
    const result: SnippetFile[] = [];
    for (const file of files) {
        const key = uriKey(file.uri);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(file);
    }
    return result;
}

/** Deduped and sorted within the root, ready to be rendered under one separator. */
export function prepareGroup(
    files: readonly SnippetFile[],
    seen: Set<string>,
): SnippetFile[] {
    return dedupeByPath(files, seen).sort(compareByRelativePath);
}
