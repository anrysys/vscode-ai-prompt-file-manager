import * as path from 'node:path';
import * as vscode from 'vscode';
import { findRootFor } from '../config/roots';
import type { SnippetRoot } from '../model/snippet';
import { isSameUri, isUriUnder, relativePosix, uriKey } from './paths';

/**
 * Where a resource is allowed to land.
 *
 * This module is the security boundary: nothing may be created, moved or copied to a path
 * that is not strictly inside one of the configured prompt roots. It is pure and does no
 * I/O, so every rule below is testable without touching a disk.
 *
 * Rejection is modelled as a *value*, not an exception. Dropping a folder onto itself is
 * something users do constantly; it is an expected outcome, not a failure. Returning a
 * union is what lets one drop of twenty items produce one summary instead of twenty
 * dialogs.
 */

export type TransferOperation = 'move' | 'copy' | 'import';

export type PlacementRejection =
    | 'targetOutsideRoots'
    | 'sourceOutsideRoots'
    | 'sourceIsRoot'
    | 'escapesRoot'
    | 'intoDescendant'
    | 'alreadyThere'
    | 'unsupportedType';

export interface PlacementOk {
    readonly ok: true;
    readonly source: vscode.Uri;
    readonly targetDir: vscode.Uri;
    /** `targetDir` + the source's base name, before any collision resolution. */
    readonly destination: vscode.Uri;
    readonly targetRoot: SnippetRoot;
    /** POSIX path of `destination` relative to `targetRoot.uri`. Never '' or '..'-prefixed. */
    readonly relativePath: string;
    /** True when the source came from a different root. Used for wording, not for policy. */
    readonly crossRoot: boolean;
}

export interface PlacementRejected {
    readonly ok: false;
    readonly source: vscode.Uri;
    readonly reason: PlacementRejection;
    /** Already user-facing: callers may show this verbatim. */
    readonly message: string;
}

export type Placement = PlacementOk | PlacementRejected;

function reject(
    source: vscode.Uri,
    reason: PlacementRejection,
    message: string,
): PlacementRejected {
    return { ok: false, source, reason, message };
}

/**
 * Decides whether `source` may be placed into `targetDir`.
 *
 * The order of the checks is load-bearing: a folder dropped onto itself must be reported
 * as `intoDescendant`, which is actionable, rather than `alreadyThere`, which reads like
 * the operation was pointless.
 */
export function planPlacement(
    source: vscode.Uri,
    targetDir: vscode.Uri,
    roots: readonly SnippetRoot[],
    operation: TransferOperation,
): Placement {
    const name = path.basename(source.fsPath);

    const targetRoot = findRootFor(targetDir, roots);
    if (!targetRoot) {
        return reject(
            source,
            'targetOutsideRoots',
            `"${name}" can only be placed inside a configured prompts folder.`,
        );
    }

    // An import comes from outside by definition; every other operation must start inside.
    const sourceRoot = findRootFor(source, roots);
    if (operation !== 'import' && !sourceRoot) {
        return reject(
            source,
            'sourceOutsideRoots',
            `"${name}" is not inside a configured prompts folder.`,
        );
    }

    // A root is a setting that happens to name a directory, not an item living in one.
    // Moving one leaves promptManager.global.path / workspace.path pointing at a folder
    // that is no longer there, and the only symptom is a scope row quietly reading "not
    // created yet" -- so it is refused with a reason rather than reported as a success.
    //
    // Reachable from outside this extension: findRootFor treats a root as being inside
    // itself, so a prompts folder dragged in from the Explorer or from the OS file manager
    // arrives looking exactly like an ordinary cross-scope move.
    //
    // Deliberately not restricted to 'move'. Copying a root duplicates every prompt in it
    // into the other scope, splitting the usage history and leaving a recursive delete as
    // the way back; the rule is about what the source *is*, not what is being done to it.
    //
    // Before the name and descendant checks on purpose: "that is your prompts folder" is
    // the reason the user needs, and it holds whichever of the later rules would also fire.
    if (sourceRoot && isSameUri(source, sourceRoot.uri)) {
        return reject(
            source,
            'sourceIsRoot',
            `"${name}" is a configured prompts folder — point the setting somewhere else instead of moving it.`,
        );
    }

    if (name === '' || name === '.' || name === '..') {
        return reject(source, 'escapesRoot', 'That item has no usable name.');
    }

    // Covers both "folder dropped onto itself" and "folder dropped into its own subtree".
    // Harmless for files: nothing can be under a file.
    if (isUriUnder(targetDir, source)) {
        return reject(
            source,
            'intoDescendant',
            `"${name}" cannot be moved into itself.`,
        );
    }

    const destination = vscode.Uri.joinPath(targetDir, name);

    // THE containment check. It runs after joinPath has already normalised any '..', so it
    // catches a traversal that the raw strings would have hidden.
    const relativePath = relativePosix(targetRoot.uri, destination);
    if (relativePath === undefined || relativePath === '') {
        return reject(
            source,
            'escapesRoot',
            `"${name}" would end up outside the prompts folder.`,
        );
    }

    // Copying into the same folder is a legitimate "duplicate"; moving there is a no-op.
    if (operation === 'move' && isSameUri(source, destination)) {
        return reject(source, 'alreadyThere', `"${name}" is already there.`);
    }

    return {
        ok: true,
        source,
        targetDir,
        destination,
        targetRoot,
        relativePath,
        crossRoot: sourceRoot ? sourceRoot.id !== targetRoot.id : true,
    };
}

export function planPlacements(
    sources: readonly vscode.Uri[],
    targetDir: vscode.Uri,
    roots: readonly SnippetRoot[],
    operation: TransferOperation,
): { readonly accepted: PlacementOk[]; readonly rejected: PlacementRejected[] } {
    const accepted: PlacementOk[] = [];
    const rejected: PlacementRejected[] = [];
    for (const source of sources) {
        const placement = planPlacement(source, targetDir, roots, operation);
        if (placement.ok) {
            accepted.push(placement);
        } else {
            rejected.push(placement);
        }
    }
    return { accepted, rejected };
}

/** Collapses items that resolve to the same path; overlapping roots can yield duplicates. */
export function dedupeByUri<T>(items: readonly T[], uriOf: (item: T) => vscode.Uri): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of items) {
        const key = uriKey(uriOf(item));
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
    }
    return result;
}

/**
 * Drops any item that lives inside another item in the same list.
 *
 * Without this, selecting a folder *and* a file inside it and moving both makes the second
 * operation fail with FileNotFound, because the first one already carried it along.
 */
export function pruneNested<T>(items: readonly T[], uriOf: (item: T) => vscode.Uri): T[] {
    const unique = dedupeByUri(items, uriOf);
    // Shortest paths first, so an ancestor is always considered before its descendants
    // and the result does not depend on the order the user happened to click in.
    const byDepth = [...unique].sort(
        (a, b) => uriKey(uriOf(a)).length - uriKey(uriOf(b)).length,
    );

    const kept: T[] = [];
    for (const item of byDepth) {
        const uri = uriOf(item);
        const nested = kept.some((other) => isUriUnder(uri, uriOf(other)));
        if (!nested) {
            kept.push(item);
        }
    }
    return kept;
}
