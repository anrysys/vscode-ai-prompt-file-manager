import * as vscode from 'vscode';
import { dedupeByUri, pruneNested } from '../fs/boundary';
import type { SnippetRoot } from '../model/snippet';
import {
    targetDirectoryOf,
    uriOf,
    type FileNode,
    type FolderNode,
    type PromptNode,
} from '../tree/nodes';

/** A node that names a resource on disk. Roots are configured directories, not resources. */
export type ResourceNode = FolderNode | FileNode;

export function isResourceNode(node: PromptNode): node is ResourceNode {
    return node.type !== 'root';
}

/**
 * Works out which items a command should act on.
 *
 * A `view/item/context` command is invoked with the clicked node first and the current
 * selection second, but a command palette entry passes nothing at all and a keybinding
 * passes nothing either -- which is why `treeView.selection` is the last resort.
 */
export function resolveSelection(
    node: PromptNode | undefined,
    selection: readonly PromptNode[] | undefined,
    treeView: vscode.TreeView<PromptNode>,
): ResourceNode[] {
    const base = pickBase(node, selection, treeView);
    const resources = base.filter(isResourceNode);
    // Pruning matters for every destructive verb: deleting a folder and a file inside it
    // would otherwise fail on the second item, which has already gone with the first.
    return pruneNested(dedupeByUri(resources, (n) => n.entry.uri), (n) => n.entry.uri);
}

/**
 * The same rows, for commands that only *read* them.
 *
 * Two deliberate differences from `resolveSelection`. Roots stay in: a root names a real
 * directory, so "where is this?" has an answer for it, even though nothing may be created,
 * moved or deleted there by name. And nothing is pruned: dropping the child of a selected
 * folder is right for a move, which would carry it along anyway, but a Copy Path that
 * silently leaves out a row the user selected puts *wrong* text on the clipboard, and wrong
 * is worse than long. The Explorer copies both paths too.
 */
export function resolveSelectionForReading(
    node: PromptNode | undefined,
    selection: readonly PromptNode[] | undefined,
    treeView: vscode.TreeView<PromptNode>,
): PromptNode[] {
    // Deduplicated all the same: overlapping roots can surface one directory twice.
    return dedupeByUri(pickBase(node, selection, treeView), uriOf);
}

function pickBase(
    node: PromptNode | undefined,
    selection: readonly PromptNode[] | undefined,
    treeView: vscode.TreeView<PromptNode>,
): readonly PromptNode[] {
    if (selection && selection.length > 0) {
        // Right-clicking a row *outside* the current selection must act on that row alone.
        // VS Code already passes the arguments that way, but checking makes the guarantee
        // ours rather than the host's.
        if (!node || selection.some((item) => item.id === node.id)) {
            return selection;
        }
    }
    if (node) {
        return [node];
    }
    return treeView.selection;
}

/**
 * The directory an item should be dropped or pasted into.
 *
 * A file is not a container, so a drop onto a file row means "into the folder it lives in",
 * which is how the Explorer behaves. `undefined` means the caller must ask.
 */
export function targetDirectoryFor(
    node: PromptNode | undefined,
    roots: readonly SnippetRoot[],
): vscode.Uri | undefined {
    if (!node) {
        // A drop on empty space is only unambiguous when there is a single root.
        return roots.length === 1 ? roots[0]?.uri : undefined;
    }
    if (node.type === 'file') {
        return vscode.Uri.joinPath(node.entry.uri, '..');
    }
    return targetDirectoryOf(node);
}
