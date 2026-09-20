import type * as vscode from 'vscode';
import { isKeyUnder, uriKey } from '../fs/paths';
import { log } from '../log';
import type { SnippetFile } from '../model/snippet';

/** `Record<string, number>` in globalState, keyed by `uriKey`. */
const STORAGE_KEY = 'promptManager.usageCounts';

/**
 * How the picker asks for a snippet's score. A plain function, so the ordering module never
 * has to know that state exists at all.
 */
export type UsageLookup = (file: SnippetFile) => number;

/**
 * What the picker needs from the tracker: rank the snippets it is about to show, and tell the
 * store which of them still exist. Narrow on purpose, so the picker does not depend on the
 * write side of usage tracking.
 */
export interface PickerUsage {
    readonly lookup: UsageLookup;
    pruneTo(liveKeys: ReadonlySet<string>, scannedRoots: readonly vscode.Uri[]): Promise<void>;
}

/**
 * Counts how often each snippet has been inserted or copied, so the picker can float the
 * ones actually in use to the top.
 *
 * Deliberately *not* synced across machines (`setKeysForSync` is never called): which prompts
 * someone reaches for is a habit formed on one keyboard, not a setting worth replicating.
 *
 * Every write is best-effort. This is bookkeeping hanging off the insert path, and that path
 * has destroyed a user's work before -- a failed `Memento.update` must never be the reason an
 * insert reports failure. The in-memory map is updated first and unconditionally, so a session
 * whose writes are all failing still ranks correctly until the window closes.
 */
export class UsageTracker implements PickerUsage {
    private readonly counts: Map<string, number>;

    constructor(private readonly memento: vscode.Memento) {
        const stored = memento.get<Record<string, number>>(STORAGE_KEY, {});
        this.counts = new Map(
            Object.entries(stored).filter(
                (entry): entry is [string, number] => Number.isFinite(entry[1]),
            ),
        );
    }

    countOf(uri: vscode.Uri): number {
        return this.counts.get(uriKey(uri)) ?? 0;
    }

    /**
     * Bound so it can be handed straight to the picker. Sorting calls this once per file per
     * open, which is why the counts live in a Map rather than being re-read from the Memento.
     */
    readonly lookup: UsageLookup = (file) => this.countOf(file.uri);

    /**
     * Guarded end to end, not just around the write. This is called from inside the insert
     * command's `guard(...)`, so anything thrown here would surface to the user as "Could not
     * insert snippet" for an insert that had already succeeded.
     */
    async record(uri: vscode.Uri): Promise<void> {
        try {
            const key = uriKey(uri);
            this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
        } catch (error) {
            log.error(error, 'Could not count snippet usage');
            return;
        }
        await this.flush();
    }

    /**
     * Carries counts across a rename. Moves a whole key *prefix*, because the rename command
     * renames folders too: renaming `refactor/` must not reset every snippet inside it.
     */
    async migrate(from: vscode.Uri, to: vscode.Uri): Promise<void> {
        const oldPrefix = uriKey(from);
        const newPrefix = uriKey(to);
        if (oldPrefix === newPrefix) {
            return;
        }
        const moved: [string, number][] = [];
        for (const [key, count] of this.counts) {
            if (isKeyUnder(key, oldPrefix)) {
                moved.push([newPrefix + key.slice(oldPrefix.length), count]);
                this.counts.delete(key);
            }
        }
        if (moved.length === 0) {
            return;
        }
        for (const [key, count] of moved) {
            this.counts.set(key, count);
        }
        await this.flush();
    }

    /**
     * Reclaims keys for snippets that no longer exist, so the store cannot grow forever.
     *
     * Scoped to the roots that were actually scanned: a key is only a candidate for removal if
     * it lives under one of them. Pruning against the bare live set would wipe the history of a
     * workspace that merely happens to be closed right now.
     */
    async pruneTo(
        liveKeys: ReadonlySet<string>,
        scannedRoots: readonly vscode.Uri[],
    ): Promise<void> {
        if (scannedRoots.length === 0) {
            return;
        }
        const prefixes = scannedRoots.map(uriKey);
        let removed = false;
        for (const key of [...this.counts.keys()]) {
            if (liveKeys.has(key)) {
                continue;
            }
            if (prefixes.some((prefix) => isKeyUnder(key, prefix))) {
                this.counts.delete(key);
                removed = true;
            }
        }
        if (removed) {
            await this.flush();
        }
    }

    private async flush(): Promise<void> {
        try {
            await this.memento.update(STORAGE_KEY, Object.fromEntries(this.counts));
        } catch (error) {
            // Swallowed on purpose: see the class comment.
            log.error(error, 'Could not persist snippet usage counts');
        }
    }
}
