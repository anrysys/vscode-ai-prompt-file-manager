import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveSelection } from '../commands/selection';
import { FileNode, FolderNode, RootNode, type PromptNode } from '../tree/nodes';
import type { SnippetRoot } from '../model/snippet';

/**
 * Which rows a command acts on is decided here, and getting it wrong is destructive:
 * Delete acting on the whole selection when the user right-clicked a different row would
 * throw away work. The nodes are real TreeItem subclasses; only the view is faked, because
 * TreeView cannot be constructed outside a registered view.
 */

const base = vscode.Uri.file(path.join(os.tmpdir(), 'selection-suite'));
const root: SnippetRoot = {
    id: 'global',
    scope: 'global',
    label: 'Global Prompts',
    badge: 'Global',
    uri: base,
};

function file(relativePath: string): FileNode {
    return new FileNode({
        kind: 'file',
        uri: vscode.Uri.joinPath(base, ...relativePath.split('/')),
        name: path.posix.basename(relativePath),
        label: path.posix.basename(relativePath),
        root,
        relativePath,
        size: 0,
        mtime: 0,
    });
}

function folder(relativePath: string): FolderNode {
    return new FolderNode({
        kind: 'folder',
        uri: vscode.Uri.joinPath(base, ...relativePath.split('/')),
        name: path.posix.basename(relativePath),
        label: path.posix.basename(relativePath),
        root,
        relativePath,
    });
}

/** Only `selection` is ever read, and a real TreeView needs a registered view. */
function viewWith(selection: PromptNode[]): vscode.TreeView<PromptNode> {
    return { selection } as unknown as vscode.TreeView<PromptNode>;
}

const empty = viewWith([]);

suite('resolveSelection', () => {
    test('acts on the whole selection when the clicked row is part of it', () => {
        const a = file('a.md');
        const b = file('b.md');
        const items = resolveSelection(a, [a, b], empty);
        assert.strictEqual(items.length, 2);
    });

    test('acts on the clicked row alone when it sits outside the selection', () => {
        // Right-clicking a different row must not delete the five rows that were selected.
        const a = file('a.md');
        const b = file('b.md');
        const other = file('other.md');
        const items = resolveSelection(other, [a, b], empty);
        assert.deepStrictEqual(
            items.map((item) => item.entry.name),
            ['other.md'],
        );
    });

    test('falls back to the view selection when invoked with no arguments', () => {
        // This is the keybinding case: the handler is called with nothing at all.
        const a = file('a.md');
        const items = resolveSelection(undefined, undefined, viewWith([a]));
        assert.deepStrictEqual(
            items.map((item) => item.entry.name),
            ['a.md'],
        );
    });

    test('a root is never a target, even when selected', () => {
        const rootNode = new RootNode(root, false);
        assert.deepStrictEqual(resolveSelection(rootNode, [rootNode], empty), []);
    });

    test('a file inside a selected folder is not acted on twice', () => {
        const parent = folder('src');
        const child = file('src/one.md');
        const items = resolveSelection(parent, [parent, child], empty);
        assert.deepStrictEqual(
            items.map((item) => item.entry.name),
            ['src'],
        );
    });
});
