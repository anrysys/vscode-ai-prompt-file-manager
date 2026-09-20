import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SnippetRepository } from '../fs/repository';
import { describeTransfer, transfer, type UsageMigrator } from '../fs/transfer';
import { UsageTracker } from '../state/usageTracker';
import type { SnippetRoot } from '../model/snippet';

/**
 * Real temp directories throughout. Transfer is the module that actually moves a user's
 * prompts around, so a stub here would only prove that the stub matches the code.
 *
 * The usage-migration cases matter most: counts are keyed by absolute path, so a move that
 * forgets to carry them silently erases a snippet's history with no error anywhere.
 */

let tempDir: vscode.Uri;
let repo: SnippetRepository;
let root: SnippetRoot;

/** Records what a transfer asked the usage tracker to carry over. */
function recordingMigrator(): UsageMigrator & { calls: [string, string][] } {
    const calls: [string, string][] = [];
    return {
        calls,
        async migrate(from: vscode.Uri, to: vscode.Uri): Promise<void> {
            calls.push([from.fsPath, to.fsPath]);
        },
    };
}

function fakeMemento(): vscode.Memento {
    const store: Record<string, unknown> = {};
    return {
        get: <T>(key: string, fallback?: T) => (key in store ? (store[key] as T) : fallback),
        update: async (key: string, value: unknown) => {
            store[key] = value;
        },
        keys: () => Object.keys(store),
    } as unknown as vscode.Memento;
}

async function write(relativePath: string, content: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.joinPath(tempDir, ...relativePath.split('/'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    return uri;
}

function read(uri: vscode.Uri): Promise<string> {
    return Promise.resolve(vscode.workspace.fs.readFile(uri)).then((b) =>
        new TextDecoder().decode(b),
    );
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

suite('transfer', () => {
    setup(async () => {
        const unique = `prompt-transfer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        tempDir = vscode.Uri.file(path.join(os.tmpdir(), unique));
        await vscode.workspace.fs.createDirectory(tempDir);
        repo = new SnippetRepository(
            { globalStorageUri: tempDir } as unknown as vscode.ExtensionContext,
        );
        root = { id: 'test', scope: 'global', label: 'Test', badge: 'Test', uri: tempDir };
    });

    teardown(async () => {
        try {
            await vscode.workspace.fs.delete(tempDir, { recursive: true, useTrash: false });
        } catch {
            // Best effort: a failed cleanup must not fail the suite.
        }
    });

    test('moves a file into a subfolder', async () => {
        const source = await write('a.md', 'body');
        const target = vscode.Uri.joinPath(tempDir, 'folder');
        await vscode.workspace.fs.createDirectory(target);

        const result = await transfer(repo, recordingMigrator(), {
            sources: [source],
            targetDir: target,
            operation: 'move',
            roots: [root],
        });

        assert.strictEqual(result.succeeded.length, 1);
        assert.strictEqual(await exists(source), false);
        assert.strictEqual(await read(vscode.Uri.joinPath(target, 'a.md')), 'body');
    });

    test('moves a folder with everything inside it', async () => {
        await write('src/one.md', '1');
        await write('src/deep/two.md', '2');
        const target = vscode.Uri.joinPath(tempDir, 'dest');
        await vscode.workspace.fs.createDirectory(target);

        await transfer(repo, recordingMigrator(), {
            sources: [vscode.Uri.joinPath(tempDir, 'src')],
            targetDir: target,
            operation: 'move',
            roots: [root],
        });

        assert.strictEqual(await read(vscode.Uri.joinPath(target, 'src', 'one.md')), '1');
        assert.strictEqual(await read(vscode.Uri.joinPath(target, 'src', 'deep', 'two.md')), '2');
    });

    test('a name clash suffixes instead of overwriting', async () => {
        const source = await write('a.md', 'incoming');
        const target = vscode.Uri.joinPath(tempDir, 'folder');
        await vscode.workspace.fs.createDirectory(target);
        await write('folder/a.md', 'existing');

        const result = await transfer(repo, recordingMigrator(), {
            sources: [source],
            targetDir: target,
            operation: 'move',
            roots: [root],
        });

        assert.strictEqual(result.succeeded[0]?.renamed, true);
        assert.strictEqual(path.basename(result.succeeded[0]!.to.fsPath), 'a-2.md');
        // The file that was already there must be untouched.
        assert.strictEqual(await read(vscode.Uri.joinPath(target, 'a.md')), 'existing');
        assert.strictEqual(await read(vscode.Uri.joinPath(target, 'a-2.md')), 'incoming');
    });

    test('a copy leaves the original where it was', async () => {
        const source = await write('a.md', 'body');
        const target = vscode.Uri.joinPath(tempDir, 'folder');
        await vscode.workspace.fs.createDirectory(target);

        await transfer(repo, recordingMigrator(), {
            sources: [source],
            targetDir: target,
            operation: 'copy',
            roots: [root],
        });

        assert.strictEqual(await read(source), 'body');
        assert.strictEqual(await read(vscode.Uri.joinPath(target, 'a.md')), 'body');
    });

    test('a folder and a file inside it are moved once, not twice', async () => {
        // Without pruning, the second operation would fail with FileNotFound because the
        // first one already carried the child along.
        const child = await write('src/one.md', '1');
        const target = vscode.Uri.joinPath(tempDir, 'dest');
        await vscode.workspace.fs.createDirectory(target);

        const result = await transfer(repo, recordingMigrator(), {
            sources: [vscode.Uri.joinPath(tempDir, 'src'), child],
            targetDir: target,
            operation: 'move',
            roots: [root],
        });

        assert.strictEqual(result.failed.length, 0, 'nothing should have failed');
        assert.strictEqual(result.succeeded.length, 1, 'the child should not be moved separately');
        assert.strictEqual(await read(vscode.Uri.joinPath(target, 'src', 'one.md')), '1');
    });

    test('one missing source does not abandon the rest of the batch', async () => {
        const good = await write('good.md', 'here');
        const gone = vscode.Uri.joinPath(tempDir, 'gone.md');
        const target = vscode.Uri.joinPath(tempDir, 'folder');
        await vscode.workspace.fs.createDirectory(target);

        const result = await transfer(repo, recordingMigrator(), {
            sources: [gone, good],
            targetDir: target,
            operation: 'move',
            roots: [root],
        });

        assert.strictEqual(result.failed.length, 1);
        assert.strictEqual(result.succeeded.length, 1);
        assert.strictEqual(await read(vscode.Uri.joinPath(target, 'good.md')), 'here');
    });

    test('a move outside the root is rejected and changes nothing', async () => {
        const source = await write('a.md', 'body');
        const outside = vscode.Uri.file(path.join(os.tmpdir(), 'definitely-not-a-root'));

        const result = await transfer(repo, recordingMigrator(), {
            sources: [source],
            targetDir: outside,
            operation: 'move',
            roots: [root],
        });

        assert.strictEqual(result.succeeded.length, 0);
        assert.strictEqual(result.rejected[0]?.reason, 'targetOutsideRoots');
        assert.strictEqual(await exists(source), true);
        assert.strictEqual(await exists(vscode.Uri.joinPath(outside, 'a.md')), false);
    });

    test('usage is migrated to the name the file actually got', async () => {
        // The trap: migrating to the *planned* path silently loses the history whenever a
        // clash forced a rename.
        const source = await write('a.md', 'incoming');
        const target = vscode.Uri.joinPath(tempDir, 'folder');
        await vscode.workspace.fs.createDirectory(target);
        await write('folder/a.md', 'existing');
        const usage = recordingMigrator();

        await transfer(repo, usage, {
            sources: [source],
            targetDir: target,
            operation: 'move',
            roots: [root],
        });

        assert.strictEqual(usage.calls.length, 1);
        assert.strictEqual(path.basename(usage.calls[0]![1]), 'a-2.md');
    });

    test('a copy does not migrate usage: the original keeps its history', async () => {
        const source = await write('a.md', 'body');
        const target = vscode.Uri.joinPath(tempDir, 'folder');
        await vscode.workspace.fs.createDirectory(target);
        const usage = recordingMigrator();

        await transfer(repo, usage, {
            sources: [source],
            targetDir: target,
            operation: 'copy',
            roots: [root],
        });

        assert.deepStrictEqual(usage.calls, []);
    });

    test('counts recorded inside a folder survive moving that folder', async () => {
        // End to end with a real tracker: this is the silent data-loss case.
        const child = await write('src/one.md', '1');
        const target = vscode.Uri.joinPath(tempDir, 'dest');
        await vscode.workspace.fs.createDirectory(target);

        const usage = new UsageTracker(fakeMemento());
        await usage.record(child);
        await usage.record(child);
        assert.strictEqual(usage.countOf(child), 2);

        await transfer(repo, usage, {
            sources: [vscode.Uri.joinPath(tempDir, 'src')],
            targetDir: target,
            operation: 'move',
            roots: [root],
        });

        const moved = vscode.Uri.joinPath(target, 'src', 'one.md');
        assert.strictEqual(usage.countOf(moved), 2, 'the count should have followed the file');
        assert.strictEqual(usage.countOf(child), 0);
    });
});

suite('describeTransfer', () => {
    const target = vscode.Uri.file(path.join(os.tmpdir(), 'x', 'folder'));

    test('mentions the renamed count when a clash was resolved', () => {
        const message = describeTransfer({
            operation: 'move',
            targetDir: target,
            succeeded: [
                { from: target, to: target, renamed: true },
                { from: target, to: target, renamed: false },
            ],
            rejected: [],
            failed: [],
        });
        assert.ok(message.includes('Moved 2 items'), message);
        assert.ok(message.includes('renamed'), message);
    });

    test('a single rejection is explained rather than counted', () => {
        const message = describeTransfer({
            operation: 'move',
            targetDir: target,
            succeeded: [],
            rejected: [
                {
                    ok: false,
                    source: target,
                    reason: 'intoDescendant',
                    message: '"a" cannot be moved into itself.',
                },
            ],
            failed: [],
        });
        assert.strictEqual(message, '"a" cannot be moved into itself.');
    });
});
