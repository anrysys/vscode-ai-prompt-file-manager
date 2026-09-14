import type * as vscode from 'vscode';
import type { SnippetRepository } from '../fs/repository';
import type { PromptTreeProvider } from '../tree/promptTreeProvider';
import type { PromptNode } from '../tree/nodes';

export interface CommandDeps {
    readonly context: vscode.ExtensionContext;
    readonly repo: SnippetRepository;
    readonly provider: PromptTreeProvider;
    readonly treeView: vscode.TreeView<PromptNode>;
}
