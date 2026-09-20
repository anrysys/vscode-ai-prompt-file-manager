import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { uriKey } from '../fs/paths';
import { UsageTracker } from '../state/usageTracker';

/**
 * The Memento is the one VS Code object worth faking here: the real globalState is shared with
 * every other test in the host, so counts would leak between runs.
 */
function fakeMemento(seed: Record<string, unknown> = {}): vscode.Memento & { store: Record<string, unknown> } {
    const store: Record<string, unknown> = { ...seed };
    return {
        store,
        get: (key: string, fallback?: unknown) => store[key] ?? fallback,
        update: async (key: string, value: unknown) => {
            store[key] = value;
        },
        keys: () => Object.keys(store),
    } as unknown as vscode.Memento & { store: Record<string, unknown> };
}

const KEY = 'promptManager.usageCounts';
const root = vscode.Uri.file('/home/tester/prompts');
const refactor = vscode.Uri.joinPath(root, 'refactor.md');
const review = vscode.Uri.joinPath(root, 'review', 'security.md');

function stored(memento: { store: Record<string, unknown> }): Record<string, number> {
    return (memento.store[KEY] ?? {}) as Record<string, number>;
}

suite('UsageTracker', () => {
    test('a snippet nobody has used scores zero', () => {
        assert.strictEqual(new UsageTracker(fakeMemento()).countOf(refactor), 0);
    });

    test('record increments and persists', async () => {
        const memento = fakeMemento();
        const tracker = new UsageTracker(memento);
        await tracker.record(refactor);
        await tracker.record(refactor);
        assert.strictEqual(tracker.countOf(refactor), 2);
        assert.strictEqual(stored(memento)[uriKey(refactor)], 2);
    });

    test('counts survive a restart', async () => {
        const memento = fakeMemento();
        await new UsageTracker(memento).record(refactor);
        assert.strictEqual(new UsageTracker(memento).countOf(refactor), 1);
    });

    test('a failing store still ranks correctly for this session', async () => {
        const broken = {
            get: () => ({}),
            update: async () => {
                throw new Error('disk full');
            },
            keys: () => [],
        } as unknown as vscode.Memento;
        const tracker = new UsageTracker(broken);
        await tracker.record(refactor);
        assert.strictEqual(tracker.countOf(refactor), 1);
    });

    test('lookup can be detached from the tracker', async () => {
        const tracker = new UsageTracker(fakeMemento());
        await tracker.record(refactor);
        const { lookup } = tracker;
        assert.strictEqual(
            lookup({ uri: refactor } as Parameters<typeof lookup>[0]),
            1,
        );
    });

    suite('migrate', () => {
        test('carries the count to the new name', async () => {
            const tracker = new UsageTracker(fakeMemento());
            await tracker.record(refactor);
            const renamed = vscode.Uri.joinPath(root, 'refactor-hard.md');
            await tracker.migrate(refactor, renamed);
            assert.strictEqual(tracker.countOf(renamed), 1);
            assert.strictEqual(tracker.countOf(refactor), 0);
        });

        test('carries a whole folder of snippets', async () => {
            const tracker = new UsageTracker(fakeMemento());
            await tracker.record(review);
            const movedFolder = vscode.Uri.joinPath(root, 'audit');
            await tracker.migrate(vscode.Uri.joinPath(root, 'review'), movedFolder);
            assert.strictEqual(
                tracker.countOf(vscode.Uri.joinPath(movedFolder, 'security.md')),
                1,
            );
        });

        test('a sibling with a similar prefix is left alone', async () => {
            const tracker = new UsageTracker(fakeMemento());
            const sibling = vscode.Uri.joinPath(root, 'review-notes.md');
            await tracker.record(sibling);
            await tracker.migrate(
                vscode.Uri.joinPath(root, 'review'),
                vscode.Uri.joinPath(root, 'audit'),
            );
            assert.strictEqual(tracker.countOf(sibling), 1);
        });
    });

    suite('pruneTo', () => {
        test('drops a snippet that is gone from a scanned root', async () => {
            const tracker = new UsageTracker(fakeMemento());
            await tracker.record(refactor);
            await tracker.pruneTo(new Set(), [root]);
            assert.strictEqual(tracker.countOf(refactor), 0);
        });

        test('keeps a snippet that is still there', async () => {
            const tracker = new UsageTracker(fakeMemento());
            await tracker.record(refactor);
            await tracker.pruneTo(new Set([uriKey(refactor)]), [root]);
            assert.strictEqual(tracker.countOf(refactor), 1);
        });

        test('keeps history for a root that was not scanned', async () => {
            const tracker = new UsageTracker(fakeMemento());
            const closed = vscode.Uri.file('/work/project/.vscode/prompts/review.md');
            await tracker.record(closed);
            await tracker.pruneTo(new Set(), [root]);
            assert.strictEqual(tracker.countOf(closed), 1);
        });

        test('scanning nothing prunes nothing', async () => {
            const tracker = new UsageTracker(fakeMemento());
            await tracker.record(refactor);
            await tracker.pruneTo(new Set(), []);
            assert.strictEqual(tracker.countOf(refactor), 1);
        });
    });
});
