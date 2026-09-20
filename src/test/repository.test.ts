import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SnippetRepository, SnippetTooLargeError } from '../fs/repository';
import type { SnippetRoot } from '../model/snippet';

/**
 * Integration tests against a real temp directory. The repository is the one module that
 * touches the file system, so it is worth exercising for real rather than mocking.
 */

let tempDir: vscode.Uri;
let repo: SnippetRepository;
let root: SnippetRoot;

function fakeContext(): vscode.ExtensionContext {
    return { globalStorageUri: tempDir } as unknown as vscode.ExtensionContext;
}

async function write(relativePath: string, content: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.joinPath(tempDir, ...relativePath.split('/'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    return uri;
}

suite('SnippetRepository', () => {
    setup(async () => {
        const unique = `prompt-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        tempDir = vscode.Uri.file(path.join(os.tmpdir(), unique));
        await vscode.workspace.fs.createDirectory(tempDir);
        repo = new SnippetRepository(fakeContext());
        root = {
            id: 'test',
            scope: 'global',
            label: 'Test',
            badge: 'Test',
            uri: tempDir,
        };
    });

    teardown(async () => {
        try {
            await vscode.workspace.fs.delete(tempDir, { recursive: true, useTrash: false });
        } catch {
            // Best effort: a failed cleanup must not fail the suite.
        }
    });

    test('a missing directory is an empty scope, not an error', async () => {
        const missing = vscode.Uri.joinPath(tempDir, 'does-not-exist');
        assert.deepStrictEqual(await repo.listChildren(missing, root), []);
    });

    test('lists only configured extensions, skipping dotfiles and other types', async () => {
        await write('keep.md', 'a');
        await write('keep.txt', 'b');
        await write('skip.sh', 'c');
        await write('.hidden.md', 'd');

        const names = (await repo.listChildren(tempDir, root)).map((e) => e.name).sort();
        assert.deepStrictEqual(names, ['keep.md', 'keep.txt']);
    });

    test('folders sort before files', async () => {
        await write('zzz/inner.md', 'a');
        await write('aaa.md', 'b');

        const entries = await repo.listChildren(tempDir, root);
        assert.deepStrictEqual(
            entries.map((e) => [e.kind, e.name]),
            [
                ['folder', 'zzz'],
                ['file', 'aaa.md'],
            ],
        );
    });

    test('recursive listing finds nested snippets with posix relative paths', async () => {
        await write('top.md', 'a');
        await write('one/two/deep.md', 'b');

        const files = await repo.listFilesRecursive(root);
        const relatives = files.map((f) => f.relativePath).sort();
        assert.deepStrictEqual(relatives, ['one/two/deep.md', 'top.md']);
    });

    test('reads content back byte-for-byte, including non-ASCII', async () => {
        const body = 'Обзор кода\n\nline two\n';
        const uri = await write('review.md', body);
        assert.strictEqual(await repo.readSnippet(uri), body);
    });

    test('strips a leading BOM, which would otherwise corrupt a pasted prompt', async () => {
        const uri = await write('bom.md', '\uFEFFhello');
        assert.strictEqual(await repo.readSnippet(uri), 'hello');
    });

    test('an empty file reads as an empty string rather than throwing', async () => {
        const uri = await write('empty.md', '');
        assert.strictEqual(await repo.readSnippet(uri), '');
    });

    test('refuses to read a file over the configured size limit', async () => {
        const config = vscode.workspace.getConfiguration('promptManager');
        const previous = config.get<number>('maxFileSizeKb');
        await config.update('maxFileSizeKb', 1, vscode.ConfigurationTarget.Global);
        try {
            const uri = await write('big.md', 'x'.repeat(4096));
            await assert.rejects(
                () => repo.readSnippet(uri),
                (err: unknown) => err instanceof SnippetTooLargeError,
            );
        } finally {
            await config.update('maxFileSizeKb', previous, vscode.ConfigurationTarget.Global);
        }
    });

    test('creating a snippet makes parent directories implicitly', async () => {
        const dir = vscode.Uri.joinPath(tempDir, 'a', 'b', 'c');
        const created = await repo.createSnippet(dir, 'new.md', '# New\n');
        assert.ok(await repo.exists(created));
        assert.strictEqual(await repo.readSnippet(created), '# New\n');
    });

    test('a name collision suffixes instead of overwriting', async () => {
        await repo.createSnippet(tempDir, 'dup.md', 'first');
        const second = await repo.createSnippet(tempDir, 'dup.md', 'second');

        assert.strictEqual(path.basename(second.fsPath), 'dup-2.md');
        // The original must be untouched.
        assert.strictEqual(
            await repo.readSnippet(vscode.Uri.joinPath(tempDir, 'dup.md')),
            'first',
        );
    });

    test('rename moves the file and leaves nothing behind', async () => {
        const original = await repo.createSnippet(tempDir, 'old.md', 'body');
        const renamed = await repo.rename(original, 'new.md');

        assert.strictEqual(path.basename(renamed.fsPath), 'new.md');
        assert.strictEqual(await repo.exists(original), false);
        assert.strictEqual(await repo.readSnippet(renamed), 'body');
    });

    test('creating a folder that already exists is rejected', async () => {
        await repo.createFolder(tempDir, 'dir');
        await assert.rejects(() => repo.createFolder(tempDir, 'dir'));
    });

    test('delete removes the file', async () => {
        const uri = await write('gone.md', 'x');
        await repo.delete(uri, false);
        assert.strictEqual(await repo.exists(uri), false);
    });

    test('rename refuses a name that would climb out of the folder', async () => {
        // joinPath normalises '..', so without the guard this would write outside the root.
        const original = await repo.createSnippet(tempDir, 'ok.md', 'body');
        await assert.rejects(() => repo.rename(original, '../escaped.md'));

        assert.strictEqual(await repo.exists(original), true, 'the original must survive');
        const outside = vscode.Uri.joinPath(tempDir, '..', 'escaped.md');
        assert.strictEqual(await repo.exists(outside), false, 'nothing may land outside');
    });

    test('a free name for a folder does not split on the dot', async () => {
        await repo.createFolder(tempDir, 'my.folder');
        const free = await repo.findFreeUri(tempDir, 'my.folder', { keepExtension: false });
        assert.strictEqual(path.basename(free.fsPath), 'my.folder-2');
    });

    test('copy duplicates a directory tree and leaves the source alone', async () => {
        await write('src/inner/a.md', 'body');
        const target = vscode.Uri.joinPath(tempDir, 'copy');

        await repo.copy(vscode.Uri.joinPath(tempDir, 'src'), target, { overwrite: false });

        assert.strictEqual(await repo.readSnippet(vscode.Uri.joinPath(target, 'inner', 'a.md')), 'body');
        assert.strictEqual(await repo.exists(vscode.Uri.joinPath(tempDir, 'src', 'inner', 'a.md')), true);
    });

    test('move relocates a file and leaves nothing behind', async () => {
        const source = await write('a.md', 'body');
        const target = vscode.Uri.joinPath(tempDir, 'moved.md');

        await repo.move(source, target, { overwrite: false });

        assert.strictEqual(await repo.exists(source), false);
        assert.strictEqual(await repo.readSnippet(target), 'body');
    });

    test('move onto an existing file is refused rather than silently overwriting', async () => {
        const source = await write('a.md', 'incoming');
        const target = await write('b.md', 'existing');

        await assert.rejects(() => repo.move(source, target, { overwrite: false }));
        assert.strictEqual(await repo.readSnippet(target), 'existing');
    });
});
