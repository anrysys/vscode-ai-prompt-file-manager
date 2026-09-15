import * as path from 'node:path';
import * as vscode from 'vscode';
import { Cmd } from '../constants';
import { getFileExtensions, getInsertConfig } from '../config/configuration';
import { labelFromFileName } from '../fs/paths';
import { insertSnippetText, type InsertTarget } from '../insert/inserter';
import { getMacroSourceEditor } from '../macros/editorTracker';
import { collectMacroNames } from '../macros/macroSyntax';
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
 * on disk but can still produce nothing, and the two cases need different wording or the
 * second one reads as a bug in the extension.
 */
function ensureNotEmpty(expanded: string, raw: string, label: string): boolean {
    if (expanded.trim().length > 0) {
        return true;
    }
    void vscode.window.showWarningMessage(
        raw.trim().length === 0
            ? `"${label}" is empty.`
            : `"${label}" expanded to nothing: every macro in it resolved to empty text.`,
    );
    return false;
}

/**
 * A snippet that quotes the selection must never be written back over that selection: the
 * expanded prompt would replace the code it was built from, and no notification makes that
 * a fair trade. Checked against the raw text, because with macros disabled the literal
 * `{{selection}}` would replace the code just as thoroughly.
 */
function toInsertTarget(raw: string, editor: vscode.TextEditor | undefined): InsertTarget | undefined {
    if (!editor) {
        return undefined;
    }
    const quotesSelection = !editor.selection.isEmpty && collectMacroNames(raw).has('selection');
    return { editor, writable: !quotesSelection };
}

export function registerInsertCommands(deps: CommandDeps): vscode.Disposable[] {
    const { repo } = deps;

    async function insert(ref: SnippetRef): Promise<void> {
        const raw = await repo.readSnippet(ref.uri);
        // Resolved once, before anything else can steal the focus, and then handed to both
        // halves: the editor that answered {{selection}} is the editor an editor-insert
        // strategy writes back into.
        const source = getMacroSourceEditor();
        // Expanded here and not inside insertSnippetText: that function's first action is
        // to overwrite the clipboard, so {{clipboard}} has to be read before it runs.
        const text = await resolveMacros(raw, source);
        if (!ensureNotEmpty(text, raw, ref.label)) {
            return;
        }
        const cfg = getInsertConfig();
        const outcome = await insertSnippetText(text, cfg, toInsertTarget(raw, source));
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
                // {{clipboard}} would read back whatever we are about to replace.
                const text = await resolveMacros(raw);
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
