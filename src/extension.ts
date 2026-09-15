import { activateEditorTracker } from "./macros/editorTracker";
import * as vscode from 'vscode';
import { VIEW_ID } from './constants';
import { createLogger, log } from './log';
import { affectsRoots } from './config/configuration';
import { SnippetRepository } from './fs/repository';
import { PromptTreeProvider } from './tree/promptTreeProvider';
import type { PromptNode } from './tree/nodes';
import { WatcherManager } from './watch/watcherManager';
import { registerAllCommands } from './commands';

export function activate(context: vscode.ExtensionContext): void {
    activateEditorTracker(context);
    const channel = createLogger();

    const repo = new SnippetRepository(context);
    const provider = new PromptTreeProvider(repo);
    const treeView = vscode.window.createTreeView<PromptNode>(VIEW_ID, {
        treeDataProvider: provider,
        showCollapseAll: true,
        canSelectMany: false,
    });

    const watchers = new WatcherManager(repo, () => provider.refresh());
    watchers.rebuild();

    context.subscriptions.push(
        channel,
        treeView,
        provider,
        watchers,
        ...registerAllCommands({ context, repo, provider, treeView }),
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
