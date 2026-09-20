import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
    compareByRelativePath,
    compareByUsageThenPath,
    dedupeByPath,
    orderRootsForPicker,
    pickFrequent,
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

/** Scores by relative path so the fixtures stay readable. */
function usageOf(counts: Record<string, number>) {
    return (f: SnippetFile): number => counts[f.relativePath] ?? 0;
}

suite('compareByUsageThenPath', () => {
    test('the more used file wins regardless of name', () => {
        const sorted = [file(globalRoot, 'a.md'), file(globalRoot, 'z.md')].sort(
            compareByUsageThenPath(usageOf({ 'z.md': 4 })),
        );
        assert.deepStrictEqual(sorted.map((f) => f.name), ['z.md', 'a.md']);
    });

    test('files nobody has used keep the plain alphabetical order', () => {
        const sorted = [file(globalRoot, 'a10.md'), file(globalRoot, 'a2.md')].sort(
            compareByUsageThenPath(usageOf({})),
        );
        assert.deepStrictEqual(sorted.map((f) => f.name), ['a2.md', 'a10.md']);
    });

    test('a tie on usage falls back to the path order', () => {
        const counts = { 'b.md': 3, 'a.md': 3 };
        const sorted = [file(globalRoot, 'b.md'), file(globalRoot, 'a.md')].sort(
            compareByUsageThenPath(usageOf(counts)),
        );
        assert.deepStrictEqual(sorted.map((f) => f.name), ['a.md', 'b.md']);
    });
});

suite('pickFrequent', () => {
    const files = [
        file(globalRoot, 'refactor.md'),
        file(globalRoot, 'explain.md'),
        file(wsRoot, 'review.md'),
    ];
    const counts = usageOf({ 'refactor.md': 47, 'review.md': 12 });

    test('spans roots, most used first', () => {
        assert.deepStrictEqual(
            pickFrequent(files, counts, 5).map((f) => f.name),
            ['refactor.md', 'review.md'],
        );
    });

    test('never lists a file nobody has used', () => {
        assert.strictEqual(
            pickFrequent(files, counts, 5).some((f) => f.name === 'explain.md'),
            false,
        );
    });

    test('respects the limit', () => {
        assert.deepStrictEqual(
            pickFrequent(files, counts, 1).map((f) => f.name),
            ['refactor.md'],
        );
    });

    test('a limit of 0 hides the group', () => {
        assert.deepStrictEqual(pickFrequent(files, counts, 0), []);
    });

    test('does not reorder the caller\'s array', () => {
        const input = [...files];
        pickFrequent(input, counts, 5);
        assert.deepStrictEqual(input.map((f) => f.name), files.map((f) => f.name));
    });
});
