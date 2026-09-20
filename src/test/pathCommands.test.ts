import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { absolutePathOf, relativePathOf } from '../commands/pathCommands';
import { FileNode, FolderNode, RootNode } from '../tree/nodes';
import type { SnippetRoot } from '../model/snippet';

/**
 * The two projections a row is copied through. Pure, so they are tested without a host:
 * what matters here is the shape of the string that lands on the clipboard, and the one
 * case that has no obvious answer -- what a root's relative path even is.
 */

const base = vscode.Uri.file(path.join(os.tmpdir(), 'path-commands-suite'));
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

suite('path projections', () => {
    test("a root's relative path is '.', never an empty line", () => {
        // An empty string here would be a blank line in the middle of a multi-row copy,
        // which reads as a bug rather than as "this is the root".
        assert.strictEqual(relativePathOf(new RootNode(root, false)), '.');
    });

    test('a root that does not exist yet still has a path', () => {
        assert.strictEqual(absolutePathOf(new RootNode(root, true)), base.fsPath);
    });

    test('a nested file keeps POSIX separators wherever it is copied on', () => {
        // Forward slashes on every platform: the model's contract for relativePath, and
        // what keeps a copied path portable to the machine the prompt is headed for.
        assert.strictEqual(relativePathOf(file('refactor/rename.md')), 'refactor/rename.md');
    });

    test('the absolute path is the native one', () => {
        // Backslashes on Windows, by construction -- this is going into a shell.
        assert.strictEqual(absolutePathOf(file('a.md')), path.join(base.fsPath, 'a.md'));
    });

    test('several rows join one per line, with no trailing newline', () => {
        const text = [folder('src'), file('src/one.md')].map(relativePathOf).join('\n');
        assert.strictEqual(text, 'src\nsrc/one.md');
        assert.strictEqual(text.split('\n').length, 2);
        assert.ok(!text.endsWith('\n'));
    });
});
