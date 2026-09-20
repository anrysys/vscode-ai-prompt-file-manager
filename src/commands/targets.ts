import * as vscode from 'vscode';
import type { SnippetRepository } from '../fs/repository';
import type { PromptTreeProvider } from '../tree/promptTreeProvider';
import type { SnippetRoot } from '../model/snippet';
import { rootOf, targetDirectoryOf, type PromptNode } from '../tree/nodes';

/**
 * Shared "where should this go?" and "show me what just happened" helpers.
 *
 * Extracted from the crud command closure so creating, pasting and importing all resolve a
 * destination the same way, rather than each growing its own variant.
 */

export interface CreateTarget {
    readonly dir: vscode.Uri;
    readonly root: SnippetRoot;
}

/** Resolves the directory a create action should target, asking when there is no node. */
export async function resolveTarget(
    repo: SnippetRepository,
    node?: PromptNode,
): Promise<CreateTarget | undefined> {
    if (node) {
        return { dir: targetDirectoryOf(node), root: rootOf(node) };
    }
    const roots = repo.getRoots();
    if (roots.length === 0) {
        void vscode.window.showWarningMessage(
            'No prompt folders are configured. Check the promptManager.global.path setting.',
        );
        return undefined;
    }
    if (roots.length === 1) {
        const only = roots[0]!;
        return { dir: only.uri, root: only };
    }
    const picked = await vscode.window.showQuickPick(
        roots.map((root) => ({ label: root.label, description: root.uri.fsPath, root })),
        { placeHolder: 'Where should this snippet live?' },
    );
    return picked ? { dir: picked.root.uri, root: picked.root } : undefined;
}

/**
 * Refreshes the tree, then selects the resource so the user can see where it landed.
 * The refresh comes first: reveal has to find a node the provider has already re-read.
 */
export async function revealUri(
    provider: PromptTreeProvider,
    treeView: vscode.TreeView<PromptNode>,
    uri: vscode.Uri,
    options: { open: boolean },
): Promise<void> {
    provider.refresh();
    if (options.open) {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
    }
    const node = await provider.findNodeForUri(uri);
    if (node) {
        await treeView.reveal(node, { select: true, focus: false });
    }
}
