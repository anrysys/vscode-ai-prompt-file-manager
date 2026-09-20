import * as vscode from 'vscode';
import { VIEW_ID } from './constants';
import { createLogger, log } from './log';
import { affectsRoots } from './config/configuration';
import { SnippetRepository } from './fs/repository';
import { activateEditorTracker } from './macros/editorTracker';
import { PromptTreeProvider } from './tree/promptTreeProvider';
import { PromptDragAndDropController } from './tree/dragAndDrop';
import type { PromptNode } from './tree/nodes';
import { WatcherManager } from './watch/watcherManager';
import { registerAllCommands } from './commands';
import { UsageTracker } from './state/usageTracker';
import { ResourceClipboard } from './state/resourceClipboard';
import { notifyTransfer } from './ui/notify';

export function activate(context: vscode.ExtensionContext): void {
    const channel = createLogger();

    // Registered first among the feature wiring: the tracker only knows about editors that
    // became active after it started listening.
    activateEditorTracker(context);

    const repo = new SnippetRepository(context);
    // One shared instance: it caches the counts in memory, so a second tracker would go
    // stale the moment the first one recorded anything.
    const usage = new UsageTracker(context.globalState);
    const provider = new PromptTreeProvider(repo);
    const clipboard = new ResourceClipboard((key, value) => {
        void vscode.commands.executeCommand('setContext', key, value);
    });
    // The buffer does not survive a window, so make sure the Paste entry starts hidden.
    clipboard.clear();

    const dragAndDrop = new PromptDragAndDropController(
        repo,
        usage,
        () => provider.refresh(),
        notifyTransfer,
    );
    const treeView = vscode.window.createTreeView<PromptNode>(VIEW_ID, {
        treeDataProvider: provider,
        showCollapseAll: true,
        // Every command that acts on a resource resolves its own selection, so deleting or
        // moving several at once is one gesture rather than one per row.
        canSelectMany: true,
        dragAndDropController: dragAndDrop,
    });

    const watchers = new WatcherManager(repo, () => provider.refresh());
    watchers.rebuild();

    context.subscriptions.push(
        channel,
        treeView,
        provider,
        watchers,
        ...registerAllCommands({ context, repo, provider, treeView, usage, clipboard }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            watchers.rebuild();
            provider.refresh();
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (affectsRoots(e)) {
                watchers.rebuild();
                provider.refresh();
            }
        }),
    );

    log.info('AI Prompt File Manager activated.');
}

export function deactivate(): void {
    // Everything is disposed through context.subscriptions.
}
