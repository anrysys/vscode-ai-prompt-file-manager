import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    dedupeByUri,
    planPlacement,
    pruneNested,
    type PlacementRejection,
} from '../fs/boundary';
import type { SnippetRoot } from '../model/snippet';

/**
 * The boundary module is the security check for every mutation, so it is tested on its
 * own, without a disk. Nothing here creates a file: these are decisions about paths, and
 * they must hold whether or not the paths happen to exist.
 */

const base = vscode.Uri.file(path.join(os.tmpdir(), 'boundary-suite'));
const globalRoot: SnippetRoot = {
    id: 'global',
    scope: 'global',
    label: 'Global Prompts',
    badge: 'Global',
    uri: vscode.Uri.joinPath(base, 'global'),
};
const workspaceRoot: SnippetRoot = {
    id: 'workspace:0',
    scope: 'workspace',
    label: 'Workspace Prompts',
    badge: 'Workspace',
    uri: vscode.Uri.joinPath(base, 'workspace'),
};
const roots = [globalRoot, workspaceRoot];

function at(root: SnippetRoot, ...segments: string[]): vscode.Uri {
    return vscode.Uri.joinPath(root.uri, ...segments);
}

function rejectionOf(
    source: vscode.Uri,
    targetDir: vscode.Uri,
    operation: 'move' | 'copy' | 'import' = 'move',
): PlacementRejection | undefined {
    const placement = planPlacement(source, targetDir, roots, operation);
    return placement.ok ? undefined : placement.reason;
}

suite('planPlacement', () => {
    test('accepts a plain move into a sibling folder', () => {
        const placement = planPlacement(
            at(globalRoot, 'a.md'),
            at(globalRoot, 'folder'),
            roots,
            'move',
        );
        assert.ok(placement.ok);
        assert.strictEqual(path.basename(placement.destination.fsPath), 'a.md');
        assert.strictEqual(placement.relativePath, 'folder/a.md');
        assert.strictEqual(placement.targetRoot.id, 'global');
        assert.strictEqual(placement.crossRoot, false);
    });

    test('rejects a target that climbs out of the root', () => {
        // joinPath normalises the '..' segments, so the escape is only visible afterwards.
        const escaped = vscode.Uri.joinPath(globalRoot.uri, 'a', '..', '..', 'outside');
        assert.strictEqual(rejectionOf(at(globalRoot, 'a.md'), escaped), 'targetOutsideRoots');
    });

    test('rejects a folder dropped onto itself', () => {
        const folder = at(globalRoot, 'refactor');
        assert.strictEqual(rejectionOf(folder, folder), 'intoDescendant');
    });

    test('rejects a folder dropped into its own subtree', () => {
        const folder = at(globalRoot, 'refactor');
        const inside = at(globalRoot, 'refactor', 'deep', 'deeper');
        assert.strictEqual(rejectionOf(folder, inside), 'intoDescendant');
    });

    test('rejects a move onto the folder the item already sits in', () => {
        assert.strictEqual(
            rejectionOf(at(globalRoot, 'folder', 'a.md'), at(globalRoot, 'folder')),
            'alreadyThere',
        );
    });

    test('but copying into the same folder is a duplicate, not a no-op', () => {
        const placement = planPlacement(
            at(globalRoot, 'folder', 'a.md'),
            at(globalRoot, 'folder'),
            roots,
            'copy',
        );
        assert.ok(placement.ok, 'copying onto its own folder should be allowed');
    });

    test('rejects a source from outside every configured root', () => {
        const stray = vscode.Uri.joinPath(base, 'elsewhere', 'a.md');
        assert.strictEqual(rejectionOf(stray, at(globalRoot, 'folder')), 'sourceOutsideRoots');
    });

    test('an import may come from outside, because that is the point of one', () => {
        const stray = vscode.Uri.joinPath(base, 'elsewhere', 'a.md');
        const placement = planPlacement(stray, at(globalRoot, 'folder'), roots, 'import');
        assert.ok(placement.ok);
        assert.strictEqual(placement.crossRoot, true);
    });

    test('a move between roots is allowed and flagged', () => {
        const placement = planPlacement(
            at(workspaceRoot, 'a.md'),
            globalRoot.uri,
            roots,
            'move',
        );
        assert.ok(placement.ok);
        assert.strictEqual(placement.crossRoot, true);
        assert.strictEqual(placement.targetRoot.id, 'global');
    });
});

suite('pruneNested', () => {
    const uris = [
        at(globalRoot, 'a'),
        at(globalRoot, 'a', 'b'),
        at(globalRoot, 'a', 'b', 'c.md'),
        at(globalRoot, 'd.md'),
    ];

    test('keeps only the outermost items', () => {
        const kept = pruneNested(uris, (u) => u).map((u) => path.basename(u.fsPath));
        assert.deepStrictEqual(kept.sort(), ['a', 'd.md']);
    });

    test('does not depend on the order the user clicked in', () => {
        const shuffled = [uris[2]!, uris[3]!, uris[0]!, uris[1]!];
        const kept = pruneNested(shuffled, (u) => u).map((u) => path.basename(u.fsPath));
        assert.deepStrictEqual(kept.sort(), ['a', 'd.md']);
    });

    test('a sibling is never mistaken for a descendant', () => {
        // 'a-b' starts with 'a' as a string but is not inside it.
        const siblings = [at(globalRoot, 'a'), at(globalRoot, 'a-b')];
        assert.strictEqual(pruneNested(siblings, (u) => u).length, 2);
    });
});

suite('dedupeByUri', () => {
    test('collapses paths that differ only by a trailing separator', () => {
        const withSlash = vscode.Uri.file(`${at(globalRoot, 'folder').fsPath}${path.sep}`);
        const deduped = dedupeByUri([at(globalRoot, 'folder'), withSlash], (u) => u);
        assert.strictEqual(deduped.length, 1);
    });
});
