import * as path from 'node:path';
import * as vscode from 'vscode';
import { isMacrosEnabled } from '../config/configuration';
import { getMacroSourceEditor } from './editorTracker';
import { askInteractiveVariables, type InteractiveAsker } from './interactivePrompt';
import {
    collectInteractiveVariables,
    collectMacroNames,
    expandMacros,
    type InteractiveValues,
    type MacroName,
} from './macroSyntax';

export interface ResolveOptions {
    /** The editor macros read from. Defaults to the tracked one, taken once. */
    readonly source?: vscode.TextEditor | undefined;
    /** Injected so the cancellation and ordering rules can be tested without a real dialog. */
    readonly ask?: InteractiveAsker | undefined;
    /** Snippet name, shown in the dialog titles so the user knows what they are filling in. */
    readonly label?: string | undefined;
}

/**
 * Reads the macros that come from the editor. Synchronous on purpose.
 *
 * `{{selection}}` and `{{active_file}}` are read with no `await` between them, so they cannot
 * come from two different editors, and — since `resolveMacros` calls this before it asks the user
 * anything — cannot be affected by the user clicking around while an input box is open.
 */
function editorValueOf(
    name: Exclude<MacroName, 'clipboard'>,
    editor: vscode.TextEditor | undefined,
): string {
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
    }
}

/**
 * Expands `{{selection}}`, `{{active_file}}`, `{{clipboard}}` and the interactive `{{?Name}}`
 * variables in snippet text. Returns `undefined` when the user cancelled.
 *
 * Operates on the in-memory string only — the snippet file on disk is never touched, so the
 * repository's "what you insert is what is on disk" contract still holds for the tree tooltip and
 * the Quick Pick preview, which read the same file and deliberately do not call this. They must
 * never start prompting on hover.
 *
 * Must run BEFORE `insertSnippetText`, whose first action is to overwrite the clipboard: calling
 * it later would make `{{clipboard}}` expand to the snippet itself.
 *
 * Three phases, in this order, and the order is the whole design:
 *
 *   1. capture every value the window can give us,
 *   2. ask the user for the rest,
 *   3. expand once.
 *
 * An input box introduces a pause that lasts as long as the user thinks — the rest of this path
 * was written when it took milliseconds. Capturing first means a selection made or cleared while
 * a dialog is open cannot change what `{{selection}}` already resolved to. Expanding last means
 * Esc at any step leaves nothing behind at all: nothing has been written yet, least of all the
 * clipboard.
 *
 * Cancellation is `undefined` rather than a thrown sentinel because both callers are wrapped in
 * `guard()`, which turns a throw into an error toast — which is exactly the "leaves no trace"
 * requirement inverted.
 *
 * Only the macros actually present are resolved. `vscode.env.clipboard.readText()` is a real
 * round-trip to the main process — on Linux it also negotiates with the current selection owner —
 * and paying that on every insert of a macro-free snippet would be a needless regression on the
 * hottest path. The *expansion* pass is not guarded the same way: a snippet whose only construct
 * is an escaped `\{{selection}}` has no macro to resolve and still needs its backslash stripped,
 * so the single replace always runs. It is a regex walk over a string already read from disk.
 */
export async function resolveMacros(
    text: string,
    opts: ResolveOptions = {},
): Promise<string | undefined> {
    if (!isMacrosEnabled()) {
        return text;
    }
    // Both collections matter: a snippet whose only construct is `{{?Language}}` contains no
    // known macro name at all, so gating on the macros alone would make it silently do nothing.
    const used = collectMacroNames(text);
    const variables = collectInteractiveVariables(text);

    // Phase 1 — capture. Resolved before the first `await`, so the editor cannot change
    // underneath us, and read from window state rather than from a lazy reference so that a
    // selection made while an input box is open cannot rewrite what we already answered with.
    const source = opts.source ?? getMacroSourceEditor();
    const values: Record<MacroName, string> = {
        selection: '',
        active_file: '',
        clipboard: '',
    };
    for (const name of used) {
        if (name !== 'clipboard') {
            values[name] = editorValueOf(name, source);
        }
    }
    // The clipboard last, because it is the only one that has to await at all.
    if (used.has('clipboard')) {
        values.clipboard = await vscode.env.clipboard.readText();
    }

    // Phase 2 — ask. Every answer is collected before anything is written anywhere.
    let answers: InteractiveValues | undefined;
    if (variables.length > 0) {
        const ask = opts.ask ?? askInteractiveVariables;
        answers = await ask(variables, opts.label ?? 'Insert snippet');
        if (answers === undefined) {
            return undefined;
        }
    }

    // Phase 3 — expand, once.
    return expandMacros(text, values, answers);
}
