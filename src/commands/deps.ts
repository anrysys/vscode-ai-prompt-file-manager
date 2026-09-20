import type * as vscode from 'vscode';
import type { SnippetRepository } from '../fs/repository';
import type { PromptTreeProvider } from '../tree/promptTreeProvider';
import type { PromptNode } from '../tree/nodes';
import type { UsageTracker } from '../state/usageTracker';
import type { ResourceClipboard } from '../state/resourceClipboard';

export interface CommandDeps {
    readonly context: vscode.ExtensionContext;
    readonly repo: SnippetRepository;
    readonly provider: PromptTreeProvider;
    readonly treeView: vscode.TreeView<PromptNode>;
    readonly usage: UsageTracker;
    readonly clipboard: ResourceClipboard;
}
