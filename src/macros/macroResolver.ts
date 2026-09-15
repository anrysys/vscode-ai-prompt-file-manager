import * as path from 'node:path';
import * as vscode from 'vscode';
import { isMacrosEnabled } from '../config/configuration';
import { getMacroSourceEditor } from './editorTracker';
import { collectMacroNames, expandMacros, type MacroName } from './macroSyntax';

/**
 * Reads one macro from live window state. Only called for macros the snippet uses.
 *
 * The editor is passed in rather than looked up here: resolving each macro separately
 * would let `{{selection}}` and `{{active_file}}` come from two different editors if the
 * user switched tabs across the `await` in between.
 */
async function valueOf(
    name: MacroName,
    editor: vscode.TextEditor | undefined,
): Promise<string> {
    switch (name) {
        case 'selection': {
            // No editor and an empty selection are the same thing to a prompt: nothing.
            if (!editor || editor.selection.isEmpty) {
                return '';
            }
            return editor.document.getText(editor.selection);
        }
        case 'active_file': {
            // `uri.path` rather than `fsPath`: always '/'-separated, so untitled and
            // virtual documents give a sane base name too.
            return editor ? path.basename(editor.document.uri.path) : '';
        }
        case 'clipboard':
            return await vscode.env.clipboard.readText();
    }
}

/**
 * Expands `{{selection}}`, `{{active_file}}` and `{{clipboard}}` in snippet text.
 *
 * Operates on the in-memory string only — the snippet file on disk is never touched, so
 * the repository's "what you insert is what is on disk" contract still holds for the tree
 * tooltip and the Quick Pick preview, which read the same file and do not call this.
 *
 * Must run BEFORE `insertSnippetText`, whose first action is to overwrite the clipboard:
 * calling it later would make `{{clipboard}}` expand to the snippet itself.
 *
 * Only the macros actually present are resolved. `vscode.env.clipboard.readText()` is a
 * real round-trip to the main process — on Linux it also negotiates with the current
 * selection owner — and paying that on every insert of a macro-free snippet would be a
 * needless regression on the hottest path.
 *
 * `source` defaults to the tracked editor and is taken once, so the caller can thread the
 * same editor into `insertSnippetText` and have the insert land where the selection was
 * read from.
 */
export async function resolveMacros(
    text: string,
    source: vscode.TextEditor | undefined = getMacroSourceEditor(),
): Promise<string> {
    if (!isMacrosEnabled()) {
        return text;
    }
    const used = collectMacroNames(text);
    if (used.size === 0) {
        return text;
    }
    const values: Record<MacroName, string> = {
        selection: '',
        active_file: '',
        clipboard: '',
    };
    for (const name of used) {
        values[name] = await valueOf(name, source);
    }
    return expandMacros(text, values);
}
