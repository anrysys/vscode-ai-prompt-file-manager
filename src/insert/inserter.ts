import * as vscode from 'vscode';
import { EDITOR_INSERT_TEXT, PASTE_ACTION } from '../constants';
import { log } from '../log';
import type { InsertConfig } from '../config/configuration';
import { buildInvocation } from './commandArgs';

/**
 * Where an editor-writing strategy may put the text.
 *
 * `writable: false` means the snippet quoted this editor's selection, so writing the
 * expanded text back would replace the very code it just quoted. That is unrecoverable
 * with one keystroke and never what someone sending a prompt to a chat panel wants, so
 * the editor strategies are skipped instead and the clipboard carries the result.
 */
export interface InsertTarget {
    readonly editor: vscode.TextEditor;
    readonly writable: boolean;
}

export type InsertOutcome =
    | { kind: 'clipboardOnly' }
    | { kind: 'guarded' }
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
 * `target` is the editor the caller resolved the snippet's macros against, plus whether
 * writing into it is safe. Passing it keeps the two halves of an editor insert on the same
 * document, and lets the guard above refuse the one case that destroys work.
 */
export async function insertSnippetText(
    text: string,
    cfg: InsertConfig,
    target?: InsertTarget,
): Promise<InsertOutcome> {
    await vscode.env.clipboard.writeText(text);

    if (cfg.strategy.length === 0) {
        return await runFocusCommand(cfg);
    }

    const available = new Set(await vscode.commands.getCommands(true));
    let guarded = false;

    for (const commandId of cfg.strategy) {
        if (commandId === EDITOR_INSERT_TEXT) {
            if (target && !target.writable) {
                log.debug('Insert strategy: skipping the editor insert, it would overwrite the quoted selection.');
                guarded = true;
                continue;
            }
            if (await insertIntoEditor(text, cfg.treatAsSnippet, target?.editor)) {
                return { kind: 'editor' };
            }
            continue;
        }

        if (!available.has(commandId)) {
            log.debug(`Insert strategy: "${commandId}" is not available in this window.`);
            continue;
        }

        if (commandId === PASTE_ACTION) {
            const focused = vscode.window.activeTextEditor;
            // The paste action is a no-op without a focused text editor, so skip it rather
            // than let it "succeed" and stop the strategy walk.
            if (!focused) {
                log.debug('Insert strategy: no active text editor, skipping paste action.');
                continue;
            }
            // Paste lands wherever the focus is, so the guard has to look at the focused
            // document rather than at the target.
            if (target && !target.writable && focused.document === target.editor.document) {
                log.debug('Insert strategy: skipping the paste action, it would overwrite the quoted selection.');
                guarded = true;
                continue;
            }
        }

        try {
            const invocation = buildInvocation(commandId, text);
            await vscode.commands.executeCommand(invocation.commandId, ...invocation.args);
            return { kind: 'command', commandId };
        } catch (err) {
            log.debug(`Insert strategy: "${commandId}" threw, trying the next one.`, err);
        }
    }

    const outcome = await runFocusCommand(cfg);
    // Only worth saying when nothing else happened: otherwise the message would describe a
    // skipped step rather than the insert the user actually got.
    return outcome.kind === 'clipboardOnly' && guarded ? { kind: 'guarded' } : outcome;
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
