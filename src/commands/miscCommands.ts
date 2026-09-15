import * as vscode from 'vscode';
import { Cmd } from '../constants';
import { log } from '../log';
import {
    getInsertToggles,
    getObsidianConfig,
    updateInsertToggles,
} from '../config/configuration';
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
            guard('Could not update the insert behaviour', async () => {
                const current = getInsertToggles();

                // Two plain choices rather than a list of command ids: the ids were the
                // whole problem, since picking the wrong one wrote prompts into code.
                const items = [
                    {
                        key: 'pasteIntoChatPanel' as const,
                        label: 'Pre-fill the chat input',
                        detail: 'Puts the prompt in the Copilot or Quick Chat box without sending it',
                        picked: current.pasteIntoChatPanel,
                    },
                    {
                        key: 'pasteIntoEditor' as const,
                        label: 'Paste into the editor',
                        detail: '$(warning) Replaces the selected text in your active code editor',
                        picked: current.pasteIntoEditor,
                    },
                ];

                const picked = await vscode.window.showQuickPick(items, {
                    canPickMany: true,
                    placeHolder:
                        'What should happen after the snippet is copied? The copy itself always happens.',
                });
                if (!picked) {
                    return;
                }

                const chosen = new Set(picked.map((item) => item.key));
                const toggles = {
                    pasteIntoChatPanel: chosen.has('pasteIntoChatPanel'),
                    pasteIntoEditor: chosen.has('pasteIntoEditor'),
                };
                await updateInsertToggles(toggles);

                const enabled = items
                    .filter((item) => chosen.has(item.key))
                    .map((item) => item.label.toLowerCase());
                const message =
                    enabled.length === 0
                        ? 'Snippets will be copied to the clipboard only.'
                        : `After copying: ${enabled.join(', ')}.`;
                void vscode.window.showInformationMessage(message);
                log.info(`Insert behaviour updated. ${message}`);
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
