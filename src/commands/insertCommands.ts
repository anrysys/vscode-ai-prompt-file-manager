import * as path from 'node:path';
import * as vscode from 'vscode';
import { Cmd } from '../constants';
import { getFileExtensions, getInsertConfig } from '../config/configuration';
import { labelFromFileName } from '../fs/paths';
import { insertSnippetText } from '../insert/inserter';
import { pickSnippet } from '../ui/quickPick';
import { guard, notifyInsert } from '../ui/notify';
import { isFileNode, type PromptNode } from '../tree/nodes';
import type { CommandDeps } from './deps';

/** A snippet identified either by tree node or by plain Uri. */
interface SnippetRef {
    readonly uri: vscode.Uri;
    readonly label: string;
}

/**
 * Commands reach us with different arguments depending on where they were invoked:
 * a `TreeItem.command` click passes what we put in `arguments`, a `view/item/context`
 * menu passes the tree node itself, and the palette passes nothing at all.
 */
function toRef(arg?: PromptNode | vscode.Uri): SnippetRef | undefined {
    if (!arg) {
        return undefined;
    }
    if (arg instanceof vscode.Uri) {
        return {
            uri: arg,
            label: labelFromFileName(path.basename(arg.fsPath), getFileExtensions()),
        };
    }
    return isFileNode(arg) ? { uri: arg.entry.uri, label: arg.entry.label } : undefined;
}

export function registerInsertCommands(deps: CommandDeps): vscode.Disposable[] {
    const { repo } = deps;

    async function insert(ref: SnippetRef): Promise<void> {
        const text = await repo.readSnippet(ref.uri);
        if (text.trim().length === 0) {
            // Overwriting the user's clipboard with nothing is worse than doing nothing.
            void vscode.window.showWarningMessage(`"${ref.label}" is empty.`);
            return;
        }
        const cfg = getInsertConfig();
        const outcome = await insertSnippetText(text, cfg);
        notifyInsert(outcome, ref.label, cfg);
    }

    async function insertViaPicker(): Promise<void> {
        const file = await pickSnippet(repo);
        if (file) {
            await insert({ uri: file.uri, label: file.label });
        }
    }

    return [
        vscode.commands.registerCommand(
            Cmd.insertSnippet,
            guard('Could not insert snippet', insertViaPicker),
        ),

        vscode.commands.registerCommand(
            Cmd.insertFromTree,
            guard('Could not insert snippet', async (arg?: PromptNode | vscode.Uri) => {
                const ref = toRef(arg);
                // Tolerates being invoked without a usable argument, e.g. from the palette.
                if (!ref) {
                    await insertViaPicker();
                    return;
                }
                await insert(ref);
            }),
        ),

        vscode.commands.registerCommand(
            Cmd.copyToClipboard,
            guard('Could not copy snippet', async (arg?: PromptNode | vscode.Uri) => {
                let ref = toRef(arg);
                if (!ref) {
                    const picked = await pickSnippet(repo);
                    ref = picked ? { uri: picked.uri, label: picked.label } : undefined;
                }
                if (!ref) {
                    return;
                }
                const text = await repo.readSnippet(ref.uri);
                await vscode.env.clipboard.writeText(text);
                vscode.window.setStatusBarMessage(
                    `$(clippy) Copied "${ref.label}" to clipboard`,
                    3000,
                );
            }),
        ),

        vscode.commands.registerCommand(
            Cmd.openSnippet,
            guard('Could not open snippet', async (arg?: PromptNode | vscode.Uri) => {
                const ref = toRef(arg);
                if (!ref) {
                    return;
                }
                const doc = await vscode.workspace.openTextDocument(ref.uri);
                // preview: true so browsing the tree does not spawn a tab per click.
                await vscode.window.showTextDocument(doc, { preview: true });
            }),
        ),
    ];
}
