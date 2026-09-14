import * as vscode from 'vscode';
import { Cmd } from '../constants';
import { log } from '../log';
import {
    getInsertConfig,
    getObsidianConfig,
    updateInsertStrategy,
} from '../config/configuration';
import { KNOWN_INSERT_COMMANDS, NON_TEXT_COMMANDS } from '../insert/commandArgs';
import {
    buildObsidianUri,
    needsVaultName,
    toExternalString,
    unsupportedCharacters,
} from '../obsidian/obsidianUri';
import { guard } from '../ui/notify';
import { isFileNode, type PromptNode } from '../tree/nodes';
import { findRootFor } from '../config/roots';
import { relativePosix } from '../fs/paths';
import type { CommandDeps } from './deps';

export function registerMiscCommands(deps: CommandDeps): vscode.Disposable[] {
    const { repo, provider } = deps;

    return [
        vscode.commands.registerCommand(Cmd.refresh, () => provider.refresh()),

        vscode.commands.registerCommand(
            Cmd.openInObsidian,
            guard('Could not open in Obsidian', async (arg?: PromptNode | vscode.Uri) => {
                const fileUri = resolveUri(arg);
                if (!fileUri) {
                    return;
                }
                const cfg = getObsidianConfig();
                if (needsVaultName(cfg)) {
                    void vscode.window.showWarningMessage(
                        'Set promptManager.obsidian.vaultName, or remove {vault} from promptManager.obsidian.uriTemplate.',
                    );
                    return;
                }

                const root = findRootFor(fileUri, repo.getRoots());
                const relativePath = root ? (relativePosix(root.uri, fileUri) ?? '') : '';
                const obsidianTarget = { absolutePath: fileUri.fsPath, relativePath };

                const target = buildObsidianUri(obsidianTarget, cfg);
                const external = toExternalString(target);
                log.info(`Opening ${external}`);

                const unsupported = unsupportedCharacters(obsidianTarget, cfg);
                if (unsupported) {
                    // VS Code re-encodes the URI on the way out, so these cannot survive.
                    await offerUri(
                        `Obsidian cannot be opened for a path containing ${unsupported}. Copy the URI and open it manually.`,
                        external,
                    );
                    return;
                }

                const opened = await vscode.env.openExternal(target);
                if (!opened) {
                    await offerUri(
                        'Could not open Obsidian. Is it installed, and is this file inside a vault?',
                        external,
                    );
                }
            }),
        ),

        vscode.commands.registerCommand(
            Cmd.revealInOS,
            guard('Could not reveal file', async (arg?: PromptNode | vscode.Uri) => {
                const uri = resolveUri(arg) ?? resolveNodeUri(arg);
                if (uri) {
                    await vscode.commands.executeCommand('revealFileInOS', uri);
                }
            }),
        ),

        vscode.commands.registerCommand(
            Cmd.openGlobalFolder,
            guard('Could not open the global prompts folder', async () => {
                const global = repo.getRoots().find((root) => root.scope === 'global');
                if (!global) {
                    void vscode.window.showWarningMessage(
                        'The Global Prompts scope is disabled.',
                    );
                    return;
                }
                await repo.ensureDirectory(global.uri);
                await vscode.commands.executeCommand('revealFileInOS', global.uri);
            }),
        ),

        vscode.commands.registerCommand(
            Cmd.configureInsert,
            guard('Could not update the insert strategy', async () => {
                const available = new Set(await vscode.commands.getCommands(true));
                const current = getInsertConfig().strategy;

                const candidates = KNOWN_INSERT_COMMANDS.filter(
                    (entry) => available.has(entry.id) || entry.id === 'editor.insertText',
                );
                if (candidates.length === 0) {
                    void vscode.window.showWarningMessage(
                        'No known text-carrying chat commands are available in this window.',
                    );
                    return;
                }

                const picked = await vscode.window.showQuickPick(
                    candidates.map((entry) => ({
                        label: entry.id,
                        detail: entry.detail,
                        picked: current.includes(entry.id),
                    })),
                    {
                        canPickMany: true,
                        placeHolder:
                            'Commands tried after copying, in order. The snippet is always copied first.',
                    },
                );
                if (!picked) {
                    return;
                }

                const chosen = picked.map((item) => item.label);
                await updateInsertStrategy(chosen);
                void vscode.window.showInformationMessage(
                    chosen.length === 0
                        ? 'Insert strategy cleared. Snippets will be copied to the clipboard only.'
                        : `Insert strategy set to: ${chosen.join(' -> ')}`,
                );
                log.info(
                    `Insert strategy updated. Commands that cannot carry text: ${NON_TEXT_COMMANDS.join(', ')}`,
                );
            }),
        ),
    ];
}

async function offerUri(message: string, uri: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(message, 'Copy URI');
    if (choice === 'Copy URI') {
        await vscode.env.clipboard.writeText(uri);
    }
}

function resolveUri(arg?: PromptNode | vscode.Uri): vscode.Uri | undefined {
    if (!arg) {
        return undefined;
    }
    if (arg instanceof vscode.Uri) {
        return arg;
    }
    return isFileNode(arg) ? arg.entry.uri : undefined;
}

/** Folders and roots have no file Uri, but can still be revealed in the OS explorer. */
function resolveNodeUri(arg?: PromptNode | vscode.Uri): vscode.Uri | undefined {
    if (!arg || arg instanceof vscode.Uri) {
        return undefined;
    }
    return arg.type === 'root' ? arg.root.uri : arg.entry.uri;
}
