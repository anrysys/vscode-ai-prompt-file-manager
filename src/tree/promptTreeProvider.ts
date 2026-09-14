import * as path from 'node:path';
import * as vscode from 'vscode';
import { SnippetTooLargeError, type SnippetRepository } from '../fs/repository';
import { formatBytes, uriKey } from '../fs/paths';
import { FileNode, FolderNode, RootNode, type PromptNode } from './nodes';
import { renderTooltipMarkdown, truncateForTooltip } from './tooltip';

export class PromptTreeProvider
    implements vscode.TreeDataProvider<PromptNode>, vscode.Disposable
{
    private readonly emitter = new vscode.EventEmitter<PromptNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    constructor(private readonly repo: SnippetRepository) {}

    getTreeItem(element: PromptNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: PromptNode): Promise<PromptNode[]> {
        if (!element) {
            const roots = this.repo.getRoots();
            return Promise.all(
                roots.map(async (root) => new RootNode(root, !(await this.repo.exists(root.uri)))),
            );
        }
        if (element.type === 'file') {
            return [];
        }

        const root = element.type === 'root' ? element.root : element.entry.root;
        const dir = element.type === 'root' ? element.root.uri : element.entry.uri;
        const children = await this.repo.listChildren(dir, root);
        return children.map((entry) =>
            entry.kind === 'folder' ? new FolderNode(entry) : new FileNode(entry),
        );
    }

    /**
     * Fills in the hover card for a snippet.
     *
     * VS Code calls this only when the item is actually hovered, and only for properties
     * left undefined by `getTreeItem`. That is what keeps the body off the hot path:
     * building the tree still reads directory entries only, never file contents.
     */
    async resolveTreeItem(
        item: vscode.TreeItem,
        element: PromptNode,
        token: vscode.CancellationToken,
    ): Promise<vscode.TreeItem> {
        if (element.type !== 'file') {
            return item;
        }
        const { uri, size } = element.entry;

        try {
            const content = await this.repo.readSnippet(uri);
            if (token.isCancellationRequested) {
                return item;
            }
            item.tooltip = new vscode.MarkdownString(
                renderTooltipMarkdown({
                    fsPath: uri.fsPath,
                    size,
                    preview: truncateForTooltip(content),
                }),
            );
        } catch (err) {
            // A hover must never surface an error dialog, so the reason goes in the card.
            item.tooltip = new vscode.MarkdownString(
                renderTooltipMarkdown({
                    fsPath: uri.fsPath,
                    size,
                    note: describePreviewFailure(err),
                }),
            );
        }
        return item;
    }

    /** Required for TreeView.reveal. Derived from relativePath, so it needs no extra state. */
    getParent(element: PromptNode): PromptNode | undefined {
        if (element.type === 'root') {
            return undefined;
        }
        const { root, relativePath } = element.entry;
        const parentRelative = path.posix.dirname(relativePath);
        if (parentRelative === '.' || parentRelative === '' || parentRelative === '/') {
            return new RootNode(root, false);
        }
        return new FolderNode({
            kind: 'folder',
            uri: vscode.Uri.joinPath(root.uri, ...parentRelative.split('/')),
            name: path.posix.basename(parentRelative),
            label: path.posix.basename(parentRelative),
            root,
            relativePath: parentRelative,
        });
    }

    refresh(node?: PromptNode): void {
        this.emitter.fire(node);
    }

    /** Walks the tree to find the node for a Uri, so a freshly created file can be revealed. */
    async findNodeForUri(uri: vscode.Uri): Promise<PromptNode | undefined> {
        const target = uriKey(uri);
        const stack: (PromptNode | undefined)[] = [undefined];

        while (stack.length > 0) {
            const parent = stack.pop();
            const children = await this.getChildren(parent);
            for (const child of children) {
                const childUri = child.type === 'root' ? child.root.uri : child.entry.uri;
                const childKey = uriKey(childUri);
                if (childKey === target) {
                    return child;
                }
                // Only descend where the target could actually live.
                if (child.type !== 'file' && target.startsWith(`${childKey}${path.sep}`)) {
                    stack.push(child);
                }
            }
        }
        return undefined;
    }

    dispose(): void {
        this.emitter.dispose();
    }
}

function describePreviewFailure(err: unknown): string {
    if (err instanceof SnippetTooLargeError) {
        return `Too large to preview (${formatBytes(err.size)}). Raise promptManager.maxFileSizeKb to load it.`;
    }
    if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
        return 'This file no longer exists. Refresh the view.';
    }
    return 'Could not read this file.';
}
