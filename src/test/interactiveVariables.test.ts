import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { toInsertTarget } from '../commands/insertCommands';
import { insertSnippetText } from '../insert/inserter';
import { askInteractiveVariables } from '../macros/interactivePrompt';
import { resolveMacros } from '../macros/macroResolver';
import {
    collectInteractiveVariables,
    collectMacroNames,
    expandMacros,
    type InteractiveVariable,
} from '../macros/macroSyntax';
import type { InsertConfig } from '../config/configuration';

/**
 * Interactive variables are the first thing in this extension that pauses between reading a
 * snippet and writing it anywhere. The pure suites pin the grammar; the host suites pin what
 * that pause is allowed to do, which is the part that can destroy someone's work.
 */

const VALUES = { selection: 'SEL', active_file: 'FILE.ts', clipboard: 'CLIP' } as const;

const names = (text: string): string[] =>
    collectInteractiveVariables(text).map((v) => v.name);

const only = (text: string): InteractiveVariable => {
    const found = collectInteractiveVariables(text);
    assert.strictEqual(found.length, 1, `expected exactly one variable in ${JSON.stringify(text)}`);
    return found[0]!;
};

suite('interactive variable syntax', () => {
    test('the three forms parse into the three shapes', () => {
        assert.deepStrictEqual(only('{{?Language}}'), {
            name: 'Language',
            prompt: 'input',
            defaultValue: '',
            options: [],
        });
        assert.deepStrictEqual(only('{{?Language=Rust}}'), {
            name: 'Language',
            prompt: 'input',
            defaultValue: 'Rust',
            options: [],
        });
        assert.deepStrictEqual(only('{{?Language:Rust|Go|Python}}'), {
            name: 'Language',
            prompt: 'pick',
            defaultValue: '',
            options: ['Rust', 'Go', 'Python'],
        });
    });

    test('malformed forms are left verbatim, exactly like an unknown macro', () => {
        // No warning and no guessing: the broken tag travels into the output where its author
        // can see it. A pick list that had quietly become a free-text box could not be noticed.
        for (const text of ['{{?}}', '{{? }}', '{{?Name:}}', '{{?Name:  }}', '{{?Name:|||}}', '{{?a|b}}']) {
            assert.deepStrictEqual(collectInteractiveVariables(text), [], text);
            assert.strictEqual(expandMacros(text, VALUES), text, text);
        }
    });

    test('a forgotten colon stays literal rather than becoming a mystery variable', () => {
        // `{{?Lang|Rust|Go}}` is the typo this codebase can do least about: it is well-formed
        // enough to look deliberate. Passing it through is what makes it visible.
        assert.deepStrictEqual(collectInteractiveVariables('{{?Lang|Rust|Go}}'), []);
        assert.strictEqual(expandMacros('{{?Lang|Rust|Go}}', VALUES), '{{?Lang|Rust|Go}}');
    });

    test('an empty default is a real, if pointless, prefill', () => {
        assert.strictEqual(only('{{?Name=}}').prompt, 'input');
        assert.strictEqual(only('{{?Name=}}').defaultValue, '');
    });

    test('empty options are dropped and duplicates collapsed', () => {
        assert.deepStrictEqual(only('{{?N:a||b}}').options, ['a', 'b']);
        assert.deepStrictEqual(only('{{?N:a|a|b}}').options, ['a', 'b']);
        assert.deepStrictEqual(only('{{?N: a | b }}').options, ['a', 'b']);
    });

    test('a single option still shows the list, so Esc can still cancel', () => {
        assert.strictEqual(only('{{?N:Rust}}').prompt, 'pick');
        assert.deepStrictEqual(only('{{?N:Rust}}').options, ['Rust']);
    });

    test('the body is trimmed before the question mark is looked for', () => {
        assert.strictEqual(only('{{ ?Lang }}').name, 'Lang');
        assert.strictEqual(only('{{? Lang }}').name, 'Lang');
        assert.strictEqual(only('{{?Name=  Rust  }}').defaultValue, 'Rust');
    });

    test('the first = or : wins, so a default may hold a colon and an option an equals', () => {
        assert.strictEqual(only('{{?Time=12:00}}').defaultValue, '12:00');
        assert.deepStrictEqual(only('{{?Op:a=b|c}}').options, ['a=b', 'c']);
    });

    test('names may hold spaces and non-latin letters', () => {
        assert.strictEqual(only('{{?Target language}}').name, 'Target language');
        assert.deepStrictEqual(only('{{?Язык:Rust|Go}}').options, ['Rust', 'Go']);
    });

    test('a variable named after a macro is still a variable', () => {
        // The `?` keeps the namespaces apart. If this leaked into collectMacroNames, the insert
        // guard would mark the editor unwritable for a snippet that never quotes anything.
        assert.strictEqual(only('{{?selection}}').name, 'selection');
        assert.strictEqual(collectMacroNames('{{?selection}}').size, 0);
    });

    test('names that collide with Object.prototype are ordinary names', () => {
        // Answers live in a Map for this reason: a plain object would answer `toString` with a
        // function and splice "[native code]" into someone's prompt.
        for (const name of ['__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
            assert.strictEqual(only(`{{?${name}}}`).name, name);
            assert.strictEqual(
                expandMacros(`{{?${name}}}`, VALUES, new Map([[name, 'ANSWER']])),
                'ANSWER',
            );
        }
    });

    test('variables are asked in reading order, once each', () => {
        assert.deepStrictEqual(
            names('{{?Lang}} {{?Fw}} {{?Lang}} {{?Db}}'),
            ['Lang', 'Fw', 'Db'],
        );
    });

    test('a bare reference never erases a spec written elsewhere', () => {
        // `{{?Lang}}` early and `{{?Lang:Rust|Go}}` later is how people actually write these:
        // the mention comes first in the prose, the definition later. Letting the bare one win
        // would silently throw the option list away.
        const found = collectInteractiveVariables('Use {{?Lang}} today. Target: {{?Lang:Rust|Go}}');
        assert.strictEqual(found.length, 1);
        assert.deepStrictEqual(found[0]!.options, ['Rust', 'Go']);
        // Two real specs still resolve first-wins.
        assert.deepStrictEqual(
            collectInteractiveVariables('{{?L:a|b}} {{?L:c|d}}')[0]!.options,
            ['a', 'b'],
        );
    });

    test('an escaped variable is never asked about', () => {
        // Asking, then emitting the literal braces, would silently discard what was typed.
        assert.deepStrictEqual(collectInteractiveVariables('\\{{?Language}}'), []);
        assert.strictEqual(expandMacros('\\{{?Language}}', VALUES), '{{?Language}}');
    });
});

suite('expanding answers', () => {
    const answers = new Map([['Lang', 'Rust']]);

    test('one answer fills every occurrence', () => {
        assert.strictEqual(
            expandMacros('{{?Lang}} and {{?Lang}}', VALUES, answers),
            'Rust and Rust',
        );
    });

    test('macros and answers are substituted in the same pass', () => {
        assert.strictEqual(
            expandMacros('{{?Lang}}: {{selection}}', VALUES, answers),
            'Rust: SEL',
        );
    });

    test('an answer is never re-scanned', () => {
        // The single-pass guarantee, from the other direction: a user who types a macro name
        // into an input box gets that text, not its expansion.
        assert.strictEqual(
            expandMacros('{{?X}}', VALUES, new Map([['X', '{{selection}} {{?X}}']])),
            '{{selection}} {{?X}}',
        );
    });

    test('dollar sequences in an answer are not replacement patterns', () => {
        assert.strictEqual(
            expandMacros('[{{?X}}]', VALUES, new Map([['X', "$& $1 $' $$"]])),
            "[$& $1 $' $$]",
        );
    });

    test('an unanswered variable stays visible rather than collapsing to nothing', () => {
        assert.strictEqual(expandMacros('{{?X}}', VALUES), '{{?X}}');
    });

    test('an answer may legitimately be empty', () => {
        assert.strictEqual(expandMacros('<{{?X}}>', VALUES, new Map([['X', '']])), '<>');
    });
});

suite('askInteractiveVariables', () => {
    test('no variables means no dialog and no cancellation', async () => {
        // Returning undefined here would read as "the user pressed Esc" and would abort every
        // ordinary macro-only insert in the extension.
        const answers = await askInteractiveVariables([], 'Snippet');
        assert.ok(answers instanceof Map);
        assert.strictEqual(answers.size, 0);
    });
});

suite('resolveMacros with interactive variables', () => {
    let previousClipboard = '';

    setup(async () => {
        previousClipboard = await vscode.env.clipboard.readText();
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.env.clipboard.writeText(previousClipboard);
    });

    async function openWithContent(content: string): Promise<vscode.TextEditor> {
        const doc = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
        return await vscode.window.showTextDocument(doc);
    }

    test('a snippet whose only macro is a variable still asks', async () => {
        // The early return used to check the known macro names alone, so this snippet contained
        // "no macros" and was handed straight back unexpanded.
        let asked = false;
        const text = await resolveMacros('Write it in {{?Language}}.', {
            ask: async (vars) => {
                asked = true;
                return new Map([[vars[0]!.name, 'Rust']]);
            },
        });

        assert.ok(asked, 'the asker should have been called');
        assert.strictEqual(text, 'Write it in Rust.');
    });

    test('Esc anywhere cancels the whole resolve', async () => {
        const text = await resolveMacros('{{?A}} {{?B}}', { ask: async () => undefined });
        assert.strictEqual(text, undefined);
    });

    test('the asker receives every variable, in order, with its spec', async () => {
        let seen: readonly InteractiveVariable[] = [];
        await resolveMacros('{{?Lang:Rust|Go}} then {{?Ticket=ABC-1}}', {
            ask: async (vars) => {
                seen = vars;
                return new Map(vars.map((v) => [v.name, 'x']));
            },
        });

        assert.deepStrictEqual(seen.map((v) => v.name), ['Lang', 'Ticket']);
        assert.deepStrictEqual(seen[0]!.options, ['Rust', 'Go']);
        assert.strictEqual(seen[1]!.defaultValue, 'ABC-1');
    });

    test('the snippet label is offered for the dialog title', async () => {
        let title = '';
        await resolveMacros('{{?X}}', {
            label: 'Explain this code',
            ask: async (vars, label) => {
                title = label;
                return new Map([[vars[0]!.name, 'v']]);
            },
        });
        assert.strictEqual(title, 'Explain this code');
    });

    test('{{selection}} is captured before the first question, not after the last', async () => {
        // The failure this prevents: ignoreFocusOut keeps the input box open while the editor
        // stays live underneath, so the user can click into it and change the selection while
        // answering. Reading the selection lazily would quote whatever they landed on.
        const editor = await openWithContent('alpha\nbeta\ngamma\n');
        editor.selection = new vscode.Selection(1, 0, 1, 4);

        const text = await resolveMacros('{{?Lang}}: {{selection}}', {
            source: editor,
            ask: async (vars) => {
                editor.selection = new vscode.Selection(2, 0, 2, 5);
                return new Map([[vars[0]!.name, 'Rust']]);
            },
        });

        assert.strictEqual(text, 'Rust: beta', 'the selection at trigger time must win');
    });

    test('a snippet that is only an escape still gets its backslash stripped', async () => {
        // The early return used to hand such a snippet straight back, so the escape never
        // happened and `\\{{selection}}` was inserted with its backslash still attached.
        assert.strictEqual(await resolveMacros('\\{{selection}}'), '{{selection}}');
        assert.strictEqual(await resolveMacros('\\{{foo}}'), '\\{{foo}}');
    });

    test('an escaped variable neither asks nor expands', async () => {
        let asked = false;
        const text = await resolveMacros('\\{{?Language}}', {
            ask: async () => {
                asked = true;
                return new Map();
            },
        });

        assert.strictEqual(asked, false);
        assert.strictEqual(text, '{{?Language}}');
    });

    test('nothing is asked when promptManager.macros.enabled is false', async () => {
        const config = vscode.workspace.getConfiguration('promptManager');
        const previous = config.get<boolean>('macros.enabled');
        await config.update('macros.enabled', false, vscode.ConfigurationTarget.Global);
        try {
            let asked = false;
            const text = await resolveMacros('{{?Language}}', {
                ask: async () => {
                    asked = true;
                    return new Map();
                },
            });

            assert.strictEqual(asked, false, 'the master switch must cover interactive variables');
            assert.strictEqual(text, '{{?Language}}');
        } finally {
            await config.update('macros.enabled', previous, vscode.ConfigurationTarget.Global);
        }
    });
});

suite('cancelling an insert leaves no trace', () => {
    const TIMEOUT_MS = 20_000;
    let tempDir: vscode.Uri | undefined;
    let previousClipboard = '';

    setup(async () => {
        previousClipboard = await vscode.env.clipboard.readText();
    });

    teardown(async () => {
        await vscode.env.clipboard.writeText(previousClipboard);
        if (tempDir) {
            try {
                await vscode.workspace.fs.delete(tempDir, { recursive: true, useTrash: false });
            } catch {
                // Best effort: a failed cleanup must not fail the suite.
            }
            tempDir = undefined;
        }
    });

    test('pressing Esc on the real input box does not touch the clipboard', async function () {
        this.timeout(TIMEOUT_MS);
        // End to end through the registered command, because the requirement is about the
        // clipboard and the clipboard is written by a function three calls further down.
        const unique = `prompt-manager-interactive-${Date.now()}`;
        tempDir = vscode.Uri.file(path.join(os.tmpdir(), unique));
        await vscode.workspace.fs.createDirectory(tempDir);
        const file = vscode.Uri.joinPath(tempDir, 'ask.md');
        await vscode.workspace.fs.writeFile(
            file,
            new TextEncoder().encode('Write it in {{?Language}}.'),
        );

        const sentinel = `clipboard-sentinel-${Date.now()}`;
        await vscode.env.clipboard.writeText(sentinel);

        let settled = false;
        const running = vscode.commands
            .executeCommand('promptManager.insertFromTree', file)
            .then(() => {
                settled = true;
            });

        // If the command had thrown instead of opening a box, it would settle here and the
        // clipboard assertion below would pass for entirely the wrong reason.
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.strictEqual(settled, false, 'the insert should be waiting on an input box');

        // No API reports that a quick input is open, so dismiss repeatedly until the command
        // comes back. Closing before it opens is harmless, which is what makes this reliable.
        const deadline = Date.now() + 10_000;
        while (!settled && Date.now() < deadline) {
            await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await running;

        assert.ok(settled, 'the insert command should have returned after the box was dismissed');
        assert.strictEqual(
            await vscode.env.clipboard.readText(),
            sentinel,
            'a cancelled insert must leave the clipboard alone',
        );
    });
});

suite('the pause cannot cost the user their selection', () => {
    const editorInsert: InsertConfig = {
        strategy: ['editor.insertText'],
        focusCommand: '',
        treatAsSnippet: false,
        notification: 'none',
    };

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    async function openSelected(content: string, selection: vscode.Selection) {
        const doc = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        editor.selection = selection;
        return { doc, editor };
    }

    test('a selection made while the box was open is never written over', async function () {
        this.timeout(10_000);
        // The 0.1.9 incident through the door the pause opens: the snippet quotes nothing, so
        // the old guard sees no reason to refuse, but the range it would overwrite is code the
        // user highlighted long after triggering the insert.
        const { editor } = await openSelected('function keep() {}\n', new vscode.Selection(0, 0, 0, 0));
        const atTrigger = [...editor.selections];

        editor.selection = new vscode.Selection(0, 0, 0, 18);
        const target = toInsertTarget('Fix ticket {{?Ticket}}', editor, atTrigger);

        assert.strictEqual(target?.writable, false);
        assert.strictEqual(target?.guardReason, 'selectionChanged');
    });

    test('an unchanged selection still allows the insert', async function () {
        this.timeout(10_000);
        const { editor } = await openSelected('\n', new vscode.Selection(0, 0, 0, 0));

        // A distinct object holding the same range, so this proves the guard compares positions
        // rather than object identity.
        const target = toInsertTarget('plain body', editor, [new vscode.Selection(0, 0, 0, 0)]);

        assert.strictEqual(target?.writable, true);
        assert.strictEqual(target?.guardReason, undefined);
    });

    test('a second cursor added while the box was open also refuses the write', async function () {
        this.timeout(10_000);
        // An editor insert replaces every selection, so a new cursor is drift of the same kind.
        const { editor } = await openSelected('one\ntwo\n', new vscode.Selection(0, 0, 0, 0));
        const atTrigger = [...editor.selections];

        editor.selections = [new vscode.Selection(0, 0, 0, 0), new vscode.Selection(1, 0, 1, 0)];
        const target = toInsertTarget('Fix ticket {{?Ticket}}', editor, atTrigger);

        assert.strictEqual(target?.writable, false);
        assert.strictEqual(target?.guardReason, 'selectionChanged');
    });

    test('quoting the selection still outranks everything', async function () {
        this.timeout(10_000);
        const { editor } = await openSelected('needle\n', new vscode.Selection(0, 0, 0, 6));

        const target = toInsertTarget('Explain {{selection}}', editor, [...editor.selections]);

        assert.strictEqual(target?.writable, false);
        assert.strictEqual(target?.guardReason, 'quotesSelection');
    });

    test('an escaped {{selection}} is guarded too', async function () {
        this.timeout(10_000);
        // It never expands, but the literal braces it leaves behind would replace the code
        // just as completely.
        const { editor } = await openSelected('needle\n', new vscode.Selection(0, 0, 0, 6));

        const target = toInsertTarget('Escaping: \\{{selection}}', editor, [...editor.selections]);

        assert.strictEqual(target?.writable, false);
        assert.strictEqual(target?.guardReason, 'quotesSelection');
    });

    test('a guarded drift keeps the code and still copies the prompt', async function () {
        this.timeout(10_000);
        const { doc, editor } = await openSelected(
            'function keep() {}\n',
            new vscode.Selection(0, 0, 0, 18),
        );

        const outcome = await insertSnippetText('Fix ticket ABC-1', editorInsert, {
            editor,
            writable: false,
            guardReason: 'selectionChanged',
        });

        assert.strictEqual(outcome.kind, 'guarded');
        assert.strictEqual(doc.getText(), 'function keep() {}\n');
        assert.strictEqual(await vscode.env.clipboard.readText(), 'Fix ticket ABC-1');
    });
});
