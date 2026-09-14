import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
    compareByRelativePath,
    dedupeByPath,
    orderRootsForPicker,
    prepareGroup,
} from '../ui/snippetOrdering';
import type { SnippetFile, SnippetRoot } from '../model/snippet';

function root(id: string, scope: 'global' | 'workspace', dir: string): SnippetRoot {
    return {
        id,
        scope,
        label: id,
        badge: id,
        uri: vscode.Uri.file(dir),
    };
}

function file(owner: SnippetRoot, relativePath: string): SnippetFile {
    const name = relativePath.split('/').pop() ?? relativePath;
    return {
        kind: 'file',
        uri: vscode.Uri.joinPath(owner.uri, ...relativePath.split('/')),
        name,
        label: name.replace(/\.md$/, ''),
        root: owner,
        relativePath,
        size: 10,
        mtime: 0,
    };
}

const globalRoot = root('global', 'global', '/home/tester/prompts');
const wsRoot = root('workspace:0', 'workspace', '/work/project/.vscode/prompts');

suite('orderRootsForPicker', () => {
    test('workspace roots come before global', () => {
        const ordered = orderRootsForPicker([globalRoot, wsRoot]);
        assert.deepStrictEqual(
            ordered.map((r) => r.id),
            ['workspace:0', 'global'],
        );
    });

    test('does not lose roots', () => {
        assert.strictEqual(orderRootsForPicker([globalRoot, wsRoot]).length, 2);
    });
});

suite('compareByRelativePath', () => {
    test('sorts numerically, so a2 precedes a10', () => {
        const sorted = [file(globalRoot, 'a10.md'), file(globalRoot, 'a2.md')].sort(
            compareByRelativePath,
        );
        assert.deepStrictEqual(
            sorted.map((f) => f.name),
            ['a2.md', 'a10.md'],
        );
    });

    test('groups a subfolder together by its path', () => {
        const sorted = [
            file(globalRoot, 'zz.md'),
            file(globalRoot, 'refactor/rename.md'),
            file(globalRoot, 'refactor/extract.md'),
        ].sort(compareByRelativePath);
        assert.deepStrictEqual(sorted.map((f) => f.relativePath), [
            'refactor/extract.md',
            'refactor/rename.md',
            'zz.md',
        ]);
    });
});

suite('dedupeByPath', () => {
    test('drops a file already seen under another root', () => {
        const seen = new Set<string>();
        const shared = file(globalRoot, 'shared.md');
        assert.strictEqual(dedupeByPath([shared], seen).length, 1);
        assert.strictEqual(dedupeByPath([shared], seen).length, 0);
    });

    test('same name in different scopes are different snippets and both survive', () => {
        const seen = new Set<string>();
        const kept = dedupeByPath(
            [file(globalRoot, 'review.md'), file(wsRoot, 'review.md')],
            seen,
        );
        assert.strictEqual(kept.length, 2);
    });
});

suite('prepareGroup', () => {
    test('dedupes and sorts in one pass', () => {
        const seen = new Set<string>();
        const group = prepareGroup(
            [
                file(globalRoot, 'b.md'),
                file(globalRoot, 'a.md'),
                file(globalRoot, 'b.md'),
            ],
            seen,
        );
        assert.deepStrictEqual(
            group.map((f) => f.name),
            ['a.md', 'b.md'],
        );
    });
});
