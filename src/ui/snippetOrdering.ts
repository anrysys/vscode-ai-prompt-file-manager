import { uriKey } from '../fs/paths';
import type { SnippetFile, SnippetRoot } from '../model/snippet';
import type { UsageLookup } from '../state/usageTracker';

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

/**
 * Most-used first, falling back to the alphabetical order so that files nobody has used --
 * all tied on zero -- keep exactly the order they would have had without this feature.
 */
export function compareByUsageThenPath(usage: UsageLookup) {
    return (a: SnippetFile, b: SnippetFile): number =>
        usage(b) - usage(a) || compareByRelativePath(a, b);
}

/**
 * The snippets worth floating above the per-root groups.
 *
 * Files never used are excluded rather than padding the group out to `limit`: a "Frequently
 * used" heading over something the user has never opened is a lie, and it would push the real
 * groups down for nothing.
 */
export function pickFrequent(
    files: readonly SnippetFile[],
    usage: UsageLookup,
    limit: number,
): SnippetFile[] {
    if (limit <= 0) {
        return [];
    }
    return files
        .filter((file) => usage(file) > 0)
        .sort(compareByUsageThenPath(usage))
        .slice(0, limit);
}
