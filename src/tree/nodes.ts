import * as vscode from 'vscode';
import { Cmd, ContextValue } from '../constants';
import type { SnippetFile, SnippetFolder, SnippetRoot } from '../model/snippet';

/**
 * Every node carries an explicit stable `id`. Without one, VS Code re-keys items on each
 * refresh, which collapses the whole tree and breaks `TreeView.reveal`.
 */

export class RootNode extends vscode.TreeItem {
    readonly type = 'root' as const;

    constructor(
        readonly root: SnippetRoot,
        readonly missing: boolean,
    ) {
        super(root.label, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `root:${root.id}`;
        this.contextValue =
            root.scope === 'global' ? ContextValue.rootGlobal : ContextValue.rootWorkspace;
        this.iconPath = new vscode.ThemeIcon(
            root.scope === 'global' ? 'globe' : 'root-folder',
        );
        this.description = missing ? 'not created yet' : root.uri.fsPath;
        this.tooltip = new vscode.MarkdownString(
            missing
                ? `\`${root.uri.fsPath}\`\n\nThis folder does not exist yet. Creating a snippet here will create it.`
                : `\`${root.uri.fsPath}\``,
        );
    }
}

export class FolderNode extends vscode.TreeItem {
    readonly type = 'folder' as const;

    constructor(readonly entry: SnippetFolder) {
        super(entry.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `folder:${entry.root.id}:${entry.relativePath}`;
        this.contextValue = ContextValue.folder;
        // resourceUri gives the themed folder icon and file decorations for free.
        this.resourceUri = entry.uri;
        this.tooltip = entry.uri.fsPath;
    }
}

export class FileNode extends vscode.TreeItem {
    readonly type = 'file' as const;

    constructor(readonly entry: SnippetFile) {
        super(entry.label, vscode.TreeItemCollapsibleState.None);
        this.id = `file:${entry.root.id}:${entry.relativePath}`;
        this.contextValue = ContextValue.file;
        this.resourceUri = entry.uri;
        // No description: the label is already the file name, and repeating it here
        // rendered every row twice. The containing folder is visible in the tree itself,
        // so the relative path would be redundant too.
        // Deliberately no tooltip here. VS Code calls TreeDataProvider.resolveTreeItem only
        // for properties that are still undefined, so setting one now would mean reading
        // every snippet body up front just to populate hovers nobody asked for.
        // A row click opens the snippet, the way clicking a file in the Explorer does.
        // The handler opens it as a preview tab, so browsing the tree neither modifies
        // anything nor piles up editors. Inserting is the inline action on the row, and
        // both it and Copy are also in the context menu, contributed from package.json.
        // A Uri is passed rather than the node so the same handler serves the palette,
        // the context menu and the Explorer.
        this.command = {
            command: Cmd.openSnippet,
            title: 'Edit Snippet',
            arguments: [entry.uri],
        };
    }
}

export type PromptNode = RootNode | FolderNode | FileNode;

export function isFileNode(node: PromptNode): node is FileNode {
    return node.type === 'file';
}

/**
 * The resource a node names on disk: a root's configured directory, or an entry's own path.
 *
 * One definition. The same ternary had already been written out in two other places, and a
 * third copy is how they start to disagree.
 */
export function uriOf(node: PromptNode): vscode.Uri {
    return node.type === 'root' ? node.root.uri : node.entry.uri;
}

/** The directory a "new snippet here" action should target for a given node. */
export function targetDirectoryOf(node: PromptNode): vscode.Uri {
    return uriOf(node);
}

export function rootOf(node: PromptNode): SnippetRoot {
    return node.type === 'root' ? node.root : node.entry.root;
}
