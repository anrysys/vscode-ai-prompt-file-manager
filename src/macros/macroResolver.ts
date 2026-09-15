import { getLastActiveTextEditor } from "./editorTracker";
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isMacrosEnabled } from '../config/configuration';
import { collectMacroNames, expandMacros, type MacroName } from './macroSyntax';

/** Reads one macro from live window state. Only called for macros the snippet uses. */
async function valueOf(name: MacroName): Promise<string> {
    switch (name) {
        case 'selection': {
            const editor = getLastActiveTextEditor();
            // No editor and an empty selection are the same thing to a prompt: nothing.
            if (!editor || editor.selection.isEmpty) {
                return '';
            }
            return editor.document.getText(editor.selection);
        }
        case 'active_file': {
            const editor = getLastActiveTextEditor();
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
 */
export async function resolveMacros(text: string): Promise<string> {
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
        values[name] = await valueOf(name);
    }
    return expandMacros(text, values);
}
