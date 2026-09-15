import * as vscode from 'vscode';
import { EDITOR_INSERT_TEXT } from '../constants';
import { log } from '../log';
import type { InsertConfig } from '../config/configuration';
import { buildInvocation } from './commandArgs';

export type InsertOutcome =
    | { kind: 'clipboardOnly' }
    | { kind: 'editor' }
    | { kind: 'command'; commandId: string }
    | { kind: 'focused'; commandId: string };

/**
 * Copies the snippet, then makes a best-effort attempt at a real insertion.
 *
 * The clipboard write is unconditional and happens first: there is no API that can type
 * into the Claude Code or Antigravity chat webviews, so Ctrl+V has to remain the
 * guaranteed path no matter what the configured strategy does.
 *
 * `target` is the editor the caller resolved the snippet's macros against. Passing it
 * keeps the two halves of "wrap my selection in a prompt" on the same document: without
 * it, `{{selection}}` could be read from the editor the user last worked in while the
 * insert landed in whatever happens to be active now.
 */
export async function insertSnippetText(
    text: string,
    cfg: InsertConfig,
    target?: vscode.TextEditor,
): Promise<InsertOutcome> {
    await vscode.env.clipboard.writeText(text);

    if (cfg.strategy.length === 0) {
        return await runFocusCommand(cfg);
    }

    const available = new Set(await vscode.commands.getCommands(true));

    for (const commandId of cfg.strategy) {
        if (commandId === EDITOR_INSERT_TEXT) {
            if (await insertIntoEditor(text, cfg.treatAsSnippet, target)) {
                return { kind: 'editor' };
            }
            continue;
        }

        if (!available.has(commandId)) {
            log.debug(`Insert strategy: "${commandId}" is not available in this window.`);
            continue;
        }

        // The paste action is a no-op without a focused text editor, so skip it rather
        // than let it "succeed" and stop the strategy walk.
        if (
            commandId === 'editor.action.clipboardPasteAction' &&
            !vscode.window.activeTextEditor
        ) {
            log.debug('Insert strategy: no active text editor, skipping paste action.');
            continue;
        }

        try {
            const invocation = buildInvocation(commandId, text);
            await vscode.commands.executeCommand(invocation.commandId, ...invocation.args);
            return { kind: 'command', commandId };
        } catch (err) {
            log.debug(`Insert strategy: "${commandId}" threw, trying the next one.`, err);
        }
    }

    return await runFocusCommand(cfg);
}

async function insertIntoEditor(
    text: string,
    asSnippet: boolean,
    target: vscode.TextEditor | undefined,
): Promise<boolean> {
    const editor = target ?? vscode.window.activeTextEditor;
    // A target whose document was closed between resolving the macros and getting here is
    // no better than no target at all.
    if (!editor || editor.document.isClosed) {
        return false;
    }
    if (asSnippet) {
        // Only on request: SnippetString treats $, {, } and \ as tabstop syntax and would
        // silently mangle a prompt containing ${VAR} or a shell $1.
        return await editor.insertSnippet(new vscode.SnippetString(text));
    }
    return await editor.edit((builder) => {
        for (const selection of editor.selections) {
            builder.replace(selection, text);
        }
    });
}

async function runFocusCommand(cfg: InsertConfig): Promise<InsertOutcome> {
    const commandId = cfg.focusCommand;
    if (commandId.length === 0) {
        return { kind: 'clipboardOnly' };
    }
    const available = new Set(await vscode.commands.getCommands(true));
    if (!available.has(commandId)) {
        log.debug(`Focus command "${commandId}" is not available in this window.`);
        return { kind: 'clipboardOnly' };
    }
    try {
        await vscode.commands.executeCommand(commandId);
        return { kind: 'focused', commandId };
    } catch (err) {
        log.debug(`Focus command "${commandId}" threw.`, err);
        return { kind: 'clipboardOnly' };
    }
}
