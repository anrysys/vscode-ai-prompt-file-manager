import * as path from 'node:path';
import * as vscode from 'vscode';
import { Cmd } from '../constants';
import { getFileExtensions, getInsertConfig } from '../config/configuration';
import { labelFromFileName } from '../fs/paths';
import { insertSnippetText, type InsertTarget } from '../insert/inserter';
import { getMacroSourceEditor } from '../macros/editorTracker';
import { collectInteractiveVariables, referencesMacro } from '../macros/macroSyntax';
import { resolveMacros } from '../macros/macroResolver';
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

/**
 * Overwriting the user's clipboard with nothing is worse than doing nothing.
 *
 * Checked after expansion, not before: a snippet that is only `{{selection}}` is not empty
 * on disk but can still produce nothing, and the three cases need different wording or they
 * read as a bug in the extension. The third one matters most: telling someone their macros
 * resolved to nothing, seconds after they typed the empty answers themselves, sends them
 * looking for a fault that is not there.
 */
function ensureNotEmpty(expanded: string, raw: string, label: string): boolean {
    if (expanded.trim().length > 0) {
        return true;
    }
    if (raw.trim().length === 0) {
        void vscode.window.showWarningMessage(`"${label}" is empty.`);
        return false;
    }
    void vscode.window.showWarningMessage(
        collectInteractiveVariables(raw).length > 0
            ? `"${label}" expanded to nothing: the values you entered were all empty.`
            : `"${label}" expanded to nothing: every macro in it resolved to empty text.`,
    );
    return false;
}

/**
 * Decides whether the expanded prompt may be written into the editor at all.
 *
 * Two ways it may not:
 *
 * A snippet that quotes the selection must never be written back over that selection — the
 * expanded prompt would replace the code it was built from, and no notification makes that a
 * fair trade. `referencesMacro` rather than `collectMacroNames`, and against the raw text,
 * because an escaped `\{{selection}}` or a disabled macro leaves the literal text `{{selection}}`
 * in the result, which would replace the code just as thoroughly.
 *
 * And a selection that appeared or moved since the snippet was read is not one the user offered
 * up. Interactive variables keep an input box open for as long as the user cares to think, and
 * `ignoreFocusOut` means they can click into the editor and drag out a selection while it is
 * open — so the range we are about to overwrite may be code they highlighted thirty seconds
 * after triggering the insert. Refusing is strictly safer than writing to a range that has
 * moved, and the clipboard still carries the result either way.
 */
export function toInsertTarget(
    raw: string,
    editor: vscode.TextEditor | undefined,
    selectionsAtTrigger: readonly vscode.Selection[] | undefined,
): InsertTarget | undefined {
    if (!editor) {
        return undefined;
    }
    if (!editor.selection.isEmpty && referencesMacro(raw, 'selection')) {
        return { editor, writable: false, guardReason: 'quotesSelection' };
    }
    if (!sameSelections(editor.selections, selectionsAtTrigger)) {
        return { editor, writable: false, guardReason: 'selectionChanged' };
    }
    return { editor, writable: true };
}

/**
 * Every selection, not just the primary one: an editor insert replaces all of them, so a second
 * cursor added while a dialog was open is drift of exactly the same kind.
 */
function sameSelections(
    current: readonly vscode.Selection[],
    atTrigger: readonly vscode.Selection[] | undefined,
): boolean {
    if (atTrigger === undefined || current.length !== atTrigger.length) {
        return false;
    }
    return current.every((selection, i) => selection.isEqual(atTrigger[i]!));
}

export function registerInsertCommands(deps: CommandDeps): vscode.Disposable[] {
    const { repo } = deps;

    async function insert(ref: SnippetRef): Promise<void> {
        const raw = await repo.readSnippet(ref.uri);
        // Resolved once, before anything else can steal the focus, and then handed to both
        // halves: the editor that answered {{selection}} is the editor an editor-insert
        // strategy writes back into.
        const source = getMacroSourceEditor();
        // Snapshotted alongside it, because resolveMacros may now sit on an input box for as
        // long as the user likes, and the selections are live the whole time. Copied, since the
        // array VS Code hands back describes the editor as it is now, not as it was.
        const selectionsAtTrigger = source ? [...source.selections] : undefined;
        // Expanded here and not inside insertSnippetText: that function's first action is
        // to overwrite the clipboard, so {{clipboard}} has to be read before it runs.
        const text = await resolveMacros(raw, { source, label: ref.label });
        // Esc during an interactive variable. Silently, and above all without touching the
        // clipboard: a cancelled insert has to leave no trace at all.
        if (text === undefined) {
            return;
        }
        if (!ensureNotEmpty(text, raw, ref.label)) {
            return;
        }
        const cfg = getInsertConfig();
        const target = toInsertTarget(raw, source, selectionsAtTrigger);
        const outcome = await insertSnippetText(text, cfg, target);
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
                const raw = await repo.readSnippet(ref.uri);
                // Same ordering rule as the insert path: expand before the write, or
                // {{clipboard}} would read back whatever we are about to replace. Interactive
                // variables are asked here too — a copy that left `{{?Language}}` in the
                // clipboard would hand the user text they cannot use.
                const text = await resolveMacros(raw, { label: ref.label });
                if (text === undefined) {
                    return;
                }
                if (!ensureNotEmpty(text, raw, ref.label)) {
                    return;
                }
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
