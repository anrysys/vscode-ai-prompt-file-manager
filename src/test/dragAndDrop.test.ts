import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TREE_MIME_TYPE, URI_LIST_MIME_TYPE } from '../constants';
import { SnippetRepository } from '../fs/repository';
import { PromptTreeProvider } from '../tree/promptTreeProvider';
import {
    PromptDragAndDropController,
    dropDirectoryFor,
    readTreeUris,
    readUriList,
    splitBySupportedType,
} from '../tree/dragAndDrop';
import type { TransferResult } from '../fs/transfer';
import { RootNode, uriOf, type PromptNode } from '../tree/nodes';
import type { SnippetRoot } from '../model/snippet';

/**
 * Drag and drop is driven end to end here rather than simulated: handleDrag and handleDrop
 * are ordinary public methods, and a real DataTransfer can be handed straight between
 * them. That covers the whole path -- payload, guards, boundary, transfer -- without
 * needing a real mouse gesture, and a stub would only prove the stub matched the code.
 */

function syntheticRoot(id: string, uri: vscode.Uri): SnippetRoot {
    return { id, scope: 'global', label: id, badge: id, uri };
}

suite('drag payload', () => {
    test('the tree mime type follows the view id', () => {
        // Pinned: VS Code derives the drop target from this string, and a silent mismatch
        // would simply stop drops working with no error anywhere.
        assert.strictEqual(TREE_MIME_TYPE, 'application/vnd.code.tree.promptmanager.view');
    });

    test('a malformed payload is ignored rather than thrown on', () => {
        for (const value of [null, 'a string', 42, { uris: 5 }, {}]) {
            const transfer = new vscode.DataTransfer();
            transfer.set(TREE_MIME_TYPE, new vscode.DataTransferItem(value));
            assert.deepStrictEqual(readTreeUris(transfer), [], `value: ${JSON.stringify(value)}`);
        }
    });

    test('a uri-list drops comments and blank lines', () => {
        const transfer = new vscode.DataTransfer();
        transfer.set(
            URI_LIST_MIME_TYPE,
            new vscode.DataTransferItem('# comment\r\nfile:///a.md\r\n\r\nfile:///b.md'),
        );
        assert.deepStrictEqual(
            readUriList(transfer).map((u) => u.path),
            ['/a.md', '/b.md'],
        );
    });
});

suite('splitBySupportedType', () => {
    test('keeps prompts and folders, skips everything else', () => {
        const { allowed, skipped } = splitBySupportedType([
            vscode.Uri.file('/x/note.md'),
            vscode.Uri.file('/x/image.png'),
            vscode.Uri.file('/x/folder'),
        ]);
        assert.deepStrictEqual(
            allowed.map((u) => path.basename(u.fsPath)).sort(),
            ['folder', 'note.md'],
        );
        assert.strictEqual(skipped.length, 1);
        assert.strictEqual(skipped[0]?.reason, 'unsupportedType');
    });
});

suite('dropDirectoryFor', () => {
    const a = syntheticRoot('a', vscode.Uri.file('/roots/a'));
    const b = syntheticRoot('b', vscode.Uri.file('/roots/b'));

    test('a drop on empty space with one root targets that root', () => {
        assert.strictEqual(dropDirectoryFor(undefined, [a])?.fsPath, a.uri.fsPath);
    });

    test('a drop on empty space with several roots is refused rather than guessed', () => {
        assert.strictEqual(dropDirectoryFor(undefined, [a, b]), undefined);
    });
});

suite('PromptDragAndDropController', () => {
    let tempDir: vscode.Uri;
    let repo: SnippetRepository;
    let provider: PromptTreeProvider;
    let controller: PromptDragAndDropController;
    let results: TransferResult[];
    let refreshes: number;
    let previousPath: string | undefined;

    const token = new vscode.CancellationTokenSource().token;

    async function write(relativePath: string, content: string): Promise<vscode.Uri> {
        const uri = vscode.Uri.joinPath(tempDir, ...relativePath.split('/'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
        return uri;
    }

    async function exists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    /** The node the tree would hand to a drag, found by walking the real provider. */
    async function nodeFor(uri: vscode.Uri): Promise<PromptNode> {
        const node = await provider.findNodeForUri(uri);
        assert.ok(node, `no tree node for ${uri.fsPath}`);
        return node;
    }

    setup(async () => {
        const unique = `prompt-dnd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        tempDir = vscode.Uri.file(path.join(os.tmpdir(), unique));
        await vscode.workspace.fs.createDirectory(tempDir);

        const config = vscode.workspace.getConfiguration('promptManager');
        previousPath = config.get<string>('global.path');
        await config.update('global.path', tempDir.fsPath, vscode.ConfigurationTarget.Global);

        repo = new SnippetRepository(
            { globalStorageUri: tempDir } as unknown as vscode.ExtensionContext,
        );
        provider = new PromptTreeProvider(repo);
        results = [];
        refreshes = 0;
        controller = new PromptDragAndDropController(
            repo,
            { async migrate() {} },
            () => {
                refreshes += 1;
            },
            (result) => {
                results.push(result);
            },
        );
    });

    teardown(async () => {
        provider.dispose();
        await vscode.workspace
            .getConfiguration('promptManager')
            .update('global.path', previousPath, vscode.ConfigurationTarget.Global);
        try {
            await vscode.workspace.fs.delete(tempDir, { recursive: true, useTrash: false });
        } catch {
            // Cleanup is best effort.
        }
    });

    test('a root is never offered as a move', async () => {
        const roots = await provider.getChildren();
        const transfer = new vscode.DataTransfer();
        controller.handleDrag(roots, transfer);
        assert.strictEqual(transfer.get(TREE_MIME_TYPE), undefined);
    });

    test('a root is still offered to the editor as a uri-list', async () => {
        const roots = await provider.getChildren();
        const transfer = new vscode.DataTransfer();
        controller.handleDrag(roots, transfer);

        assert.strictEqual(
            transfer.get(URI_LIST_MIME_TYPE)?.value,
            uriOf(roots[0]!).toString(),
        );
    });

    test('a root that does not exist yet is offered to nobody', () => {
        // Built directly rather than through a setting: handleDrag touches no disk, so
        // standing a missing root up on the file system would only slow the suite down.
        const ghost = new RootNode(
            syntheticRoot('ghost', vscode.Uri.file(path.join(os.tmpdir(), 'nope'))),
            true,
        );
        const transfer = new vscode.DataTransfer();
        controller.handleDrag([ghost], transfer);

        assert.strictEqual(transfer.get(TREE_MIME_TYPE), undefined);
        assert.strictEqual(transfer.get(URI_LIST_MIME_TYPE), undefined);
    });

    test('a root dragged beside a file moves the file and leaves the root behind', async () => {
        const uri = await write('a.md', 'body');
        const root = (await provider.getChildren())[0]!;
        const transfer = new vscode.DataTransfer();
        controller.handleDrag([root, await nodeFor(uri)], transfer);

        assert.deepStrictEqual(
            readTreeUris(transfer).map((u) => u.fsPath),
            [uri.fsPath],
            'only the file may be moved',
        );
        assert.strictEqual(
            transfer.get(URI_LIST_MIME_TYPE)?.value,
            `${uriOf(root).toString()}\r\n${uri.toString()}`,
            'both are offered to an external target',
        );
    });

    test('dragging a file offers it to the editor as a uri-list', async () => {
        const uri = await write('a.md', 'body');
        const transfer = new vscode.DataTransfer();
        controller.handleDrag([await nodeFor(uri)], transfer);

        const list = transfer.get(URI_LIST_MIME_TYPE)?.value as string;
        assert.strictEqual(list, uri.toString());
    });

    test('dragging several prompts offers them as one crlf-joined list', async () => {
        const first = await write('a.md', '1');
        const second = await write('folder/b.md', '2');
        const third = await write('c.md', '3');

        const transfer = new vscode.DataTransfer();
        controller.handleDrag(
            [await nodeFor(first), await nodeFor(second), await nodeFor(third)],
            transfer,
        );

        // The exact string, not a split-and-compare: \r\n is the part of the uri-list
        // contract worth pinning, and splitting on /\r?\n/ would pass with a bare \n too.
        assert.strictEqual(
            transfer.get(URI_LIST_MIME_TYPE)?.value,
            `${first.toString()}\r\n${second.toString()}\r\n${third.toString()}`,
        );
    });

    test('a root dragged out and dropped back is refused, not moved', async () => {
        await write('keep/a.md', 'x');
        const root = (await provider.getChildren())[0]!;

        const transfer = new vscode.DataTransfer();
        controller.handleDrag([root], transfer);
        await controller.handleDrop(
            await nodeFor(vscode.Uri.joinPath(tempDir, 'keep')),
            transfer,
            token,
        );

        assert.strictEqual(results.at(-1)?.rejected[0]?.reason, 'sourceIsRoot');
        assert.strictEqual(results.at(-1)?.succeeded.length, 0);
        assert.strictEqual(
            await exists(vscode.Uri.joinPath(tempDir, 'keep', 'a.md')),
            true,
            'the prompts folder must be untouched',
        );
    });

    test('a file dragged onto a folder moves into it', async () => {
        const source = await write('a.md', 'body');
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(tempDir, 'folder'));
        const target = await nodeFor(vscode.Uri.joinPath(tempDir, 'folder'));

        const transfer = new vscode.DataTransfer();
        controller.handleDrag([await nodeFor(source)], transfer);
        await controller.handleDrop(target, transfer, token);

        assert.strictEqual(await exists(source), false);
        assert.strictEqual(await exists(vscode.Uri.joinPath(tempDir, 'folder', 'a.md')), true);
        assert.ok(refreshes > 0, 'the tree must be refreshed after a drop');
    });

    test('a file dropped onto another file lands beside it, not inside it', async () => {
        const source = await write('a.md', 'body');
        const sibling = await write('folder/b.md', 'other');

        const transfer = new vscode.DataTransfer();
        controller.handleDrag([await nodeFor(source)], transfer);
        await controller.handleDrop(await nodeFor(sibling), transfer, token);

        assert.strictEqual(await exists(vscode.Uri.joinPath(tempDir, 'folder', 'a.md')), true);
    });

    test('a folder dropped into its own subtree is refused and changes nothing', async () => {
        await write('outer/inner/deep.md', 'x');
        const outer = await nodeFor(vscode.Uri.joinPath(tempDir, 'outer'));
        const inner = await nodeFor(vscode.Uri.joinPath(tempDir, 'outer', 'inner'));

        const transfer = new vscode.DataTransfer();
        controller.handleDrag([outer], transfer);
        await controller.handleDrop(inner, transfer, token);

        assert.strictEqual(results.at(-1)?.rejected[0]?.reason, 'intoDescendant');
        assert.strictEqual(
            await exists(vscode.Uri.joinPath(tempDir, 'outer', 'inner', 'deep.md')),
            true,
            'the original tree must be untouched',
        );
    });

    test('a folder and a file inside it move once when dragged together', async () => {
        const child = await write('src/one.md', '1');
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(tempDir, 'dest'));

        const transfer = new vscode.DataTransfer();
        controller.handleDrag(
            [await nodeFor(vscode.Uri.joinPath(tempDir, 'src')), await nodeFor(child)],
            transfer,
        );
        await controller.handleDrop(
            await nodeFor(vscode.Uri.joinPath(tempDir, 'dest')),
            transfer,
            token,
        );

        assert.strictEqual(results.at(-1)?.failed.length, 0);
        assert.strictEqual(
            await exists(vscode.Uri.joinPath(tempDir, 'dest', 'src', 'one.md')),
            true,
        );
    });

    test('a prompt dragged in from outside is copied, leaving the original alone', async () => {
        const outside = vscode.Uri.file(
            path.join(os.tmpdir(), `prompt-import-${Date.now()}.md`),
        );
        await vscode.workspace.fs.writeFile(outside, new TextEncoder().encode('imported'));

        const transfer = new vscode.DataTransfer();
        transfer.set(URI_LIST_MIME_TYPE, new vscode.DataTransferItem(outside.toString()));
        const roots = await provider.getChildren();
        await controller.handleDrop(roots[0], transfer, token);

        try {
            assert.strictEqual(
                await exists(vscode.Uri.joinPath(tempDir, path.basename(outside.fsPath))),
                true,
                'the prompt should have been imported',
            );
            assert.strictEqual(await exists(outside), true, 'importing must never move');
        } finally {
            await vscode.workspace.fs.delete(outside, { useTrash: false });
        }
    });

    test('a non-prompt dragged in from outside is skipped with a reason', async () => {
        const outside = vscode.Uri.file(path.join(os.tmpdir(), `prompt-import-${Date.now()}.png`));
        await vscode.workspace.fs.writeFile(outside, new Uint8Array([1, 2, 3]));

        const transfer = new vscode.DataTransfer();
        transfer.set(URI_LIST_MIME_TYPE, new vscode.DataTransferItem(outside.toString()));
        const roots = await provider.getChildren();
        await controller.handleDrop(roots[0], transfer, token);

        try {
            assert.strictEqual(results.at(-1)?.rejected[0]?.reason, 'unsupportedType');
            assert.strictEqual(
                await exists(vscode.Uri.joinPath(tempDir, path.basename(outside.fsPath))),
                false,
            );
        } finally {
            await vscode.workspace.fs.delete(outside, { useTrash: false });
        }
    });
});
