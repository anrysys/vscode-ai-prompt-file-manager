import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    collectMacroNames,
    expandMacros,
    MACRO_NAMES,
    referencesMacro,
} from '../macros/macroSyntax';
import { resolveMacros } from '../macros/macroResolver';

/**
 * The pure suites pin down the substitution rules; the host suite exercises the real
 * window, clipboard and settings, matching how the rest of this test folder works.
 */

const VALUES = {
    selection: 'SEL',
    active_file: 'FILE.ts',
    clipboard: 'CLIP',
} as const;

suite('expandMacros', () => {
    test('substitutes each of the three known macros', () => {
        assert.strictEqual(
            expandMacros('a {{selection}} b {{active_file}} c {{clipboard}} d', VALUES),
            'a SEL b FILE.ts c CLIP d',
        );
    });

    test('an unknown tag is left exactly as written', () => {
        const text = 'keep {{foo}} and {{ bar_baz }} and {{selection}}';
        assert.strictEqual(expandMacros(text, VALUES), 'keep {{foo}} and {{ bar_baz }} and SEL');
    });

    test('inner spaces and tabs are accepted, newlines are not', () => {
        assert.strictEqual(expandMacros('{{ selection }}', VALUES), 'SEL');
        assert.strictEqual(expandMacros('{{\tclipboard\t}}', VALUES), 'CLIP');
        assert.strictEqual(expandMacros('{{\nselection\n}}', VALUES), '{{\nselection\n}}');
    });

    test('macro names are case sensitive', () => {
        assert.strictEqual(
            expandMacros('{{Selection}} {{SELECTION}}', VALUES),
            '{{Selection}} {{SELECTION}}',
        );
    });

    test('a substituted value is never re-scanned', () => {
        // The single-pass guarantee: a clipboard holding a macro-looking string stays literal.
        const result = expandMacros('{{clipboard}}', {
            ...VALUES,
            clipboard: 'pasted {{selection}} and {{clipboard}}',
        });
        assert.strictEqual(result, 'pasted {{selection}} and {{clipboard}}');
    });

    test('dollar sequences in a value are not treated as replacement patterns', () => {
        assert.strictEqual(
            expandMacros('[{{clipboard}}]', { ...VALUES, clipboard: "$& $1 $' $$" }),
            "[$& $1 $' $$]",
        );
    });

    test('repeated macros are all substituted', () => {
        assert.strictEqual(expandMacros('{{selection}}/{{selection}}', VALUES), 'SEL/SEL');
    });

    test('an empty value collapses the tag rather than leaving braces behind', () => {
        assert.strictEqual(expandMacros('<{{selection}}>', { ...VALUES, selection: '' }), '<>');
    });

    test('text with no macros is returned unchanged, including lone braces', () => {
        const text = 'a { b } c {{ d\nJSON: {"k": {"n": 1}}\n';
        assert.strictEqual(expandMacros(text, VALUES), text);
    });

    test('a multi-line value is injected verbatim, newlines and indentation intact', () => {
        const selection = 'function f() {\n    return $1;\n}';
        assert.strictEqual(
            expandMacros('```\n{{selection}}\n```', { ...VALUES, selection }),
            '```\n' + selection + '\n```',
        );
    });
});

suite('collectMacroNames', () => {
    test('reports only the known names that are present', () => {
        assert.deepStrictEqual(
            [...collectMacroNames('{{clipboard}} {{foo}} {{clipboard}}')],
            ['clipboard'],
        );
    });

    test('macro-free text collects nothing, so no clipboard read is needed', () => {
        assert.strictEqual(collectMacroNames('plain prompt text').size, 0);
    });

    test('is not stateful across calls', () => {
        // Guards against a shared /g regex leaking lastIndex between invocations.
        const text = '{{selection}} {{clipboard}}';
        assert.deepStrictEqual([...collectMacroNames(text)], [...collectMacroNames(text)]);
        assert.strictEqual(collectMacroNames(text).size, 2);
    });

    test('every name in MACRO_NAMES is recognised', () => {
        for (const name of MACRO_NAMES) {
            assert.strictEqual(collectMacroNames(`{{${name}}}`).size, 1, name);
        }
    });
});

/**
 * 0.1.13 widened the pattern from `{{name}}` to `{{body}}` so the `?` form could share one
 * single-pass replace. These suites exist to prove that widening changed nothing else: the
 * escape is the only intended difference in behaviour for text written before 0.1.13.
 */
suite('escaping', () => {
    test('a backslash makes a known macro print itself', () => {
        assert.strictEqual(expandMacros('\\{{selection}}', VALUES), '{{selection}}');
        assert.strictEqual(expandMacros('\\{{ clipboard }}', VALUES), '{{ clipboard }}');
    });

    test('an unknown tag keeps its backslash, byte for byte', () => {
        // The backslash is consumed only where it actually suppressed an expansion, so adding
        // escaping cannot rewrite text that never had a macro in it.
        assert.strictEqual(expandMacros('\\{{foo}}', VALUES), '\\{{foo}}');
        assert.strictEqual(expandMacros('\\{{?}}', VALUES), '\\{{?}}');
    });

    test('only the backslash touching the braces is consumed', () => {
        // Documented consequence: there is no way to write a literal backslash immediately
        // before a macro that should still expand.
        assert.strictEqual(expandMacros('\\\\{{selection}}', VALUES), '\\{{selection}}');
        assert.strictEqual(expandMacros('C:\\{{selection}}', VALUES), 'C:{{selection}}');
    });

    test('a backslash anywhere else is left alone', () => {
        const text = 'C:\\Users\\dev  \\d+  \\frac{1}{2}  {{selection}}';
        assert.strictEqual(expandMacros(text, VALUES), 'C:\\Users\\dev  \\d+  \\frac{1}{2}  SEL');
    });

    test('an escaped macro is not resolved, but still counts as a reference', () => {
        // Nothing to fetch: the value would be thrown away. But the literal `{{selection}}` it
        // leaves behind would overwrite the user's code just as thoroughly, so the insert guard
        // still has to see it.
        assert.strictEqual(collectMacroNames('\\{{clipboard}}').size, 0);
        assert.ok(referencesMacro('\\{{selection}}', 'selection'));
        assert.ok(referencesMacro('{{selection}}', 'selection'));
        assert.ok(!referencesMacro('{{clipboard}}', 'selection'));
    });
});

suite('the widened pattern is backward compatible', () => {
    /** The exact name rule as it shipped in 0.1.12, frozen here as the reference. */
    const LEGACY = /\{\{[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\}\}/g;
    const legacyExpand = (text: string): string =>
        text.replace(LEGACY, (match, name: string) =>
            (MACRO_NAMES as readonly string[]).includes(name)
                ? VALUES[name as keyof typeof VALUES]
                : match,
        );

    test('unicode whitespace inside the braces stays literal', () => {
        // `String.trim()` strips all of these, so classifying the body with it would turn a
        // non-breaking space pasted in from Word or Notion into a working macro — text that is
        // literal in every released version. The plain-macro branch matches ASCII space and tab
        // only, exactly as before.
        for (const ws of ['\u00A0', '\u000B', '\u000C', '\uFEFF', '\u3000', '\u2007', '\u205F']) {
            const text = `{{${ws}selection}}`;
            assert.strictEqual(expandMacros(text, VALUES), text, JSON.stringify(ws));
        }
    });

    test('a body cannot span a line break, including U+2028 and U+2029', () => {
        for (const brk of ['\n', '\r\n', '\u2028', '\u2029', '\u0085']) {
            const text = `{{${brk}selection${brk}}}`;
            assert.strictEqual(expandMacros(text, VALUES), text, JSON.stringify(brk));
        }
    });

    test('every generated string expands exactly as 0.1.12 did, unless it is escaped', () => {
        // The pattern is the one thing here that no amount of hand-picked cases can cover, so
        // this walks the brace/whitespace/name boundary exhaustively at short lengths.
        const alphabet = [
            '{', '}', '{{', '}}', ' ', '\t', '\n', 'selection', 'clipboard', 'foo', '_', '1',
            '\\', ':', '?', '=', '|', '\u00A0', '\u2028',
        ];
        let checked = 0;
        const divergent: string[] = [];

        const walk = (prefix: string, depth: number): void => {
            if (depth === 0) {
                checked += 1;
                if (expandMacros(prefix, VALUES) !== legacyExpand(prefix)) {
                    divergent.push(prefix);
                }
                return;
            }
            for (const token of alphabet) {
                walk(prefix + token, depth - 1);
            }
        };
        for (let depth = 1; depth <= 3; depth += 1) {
            walk('', depth);
        }

        assert.ok(checked > 7000, `expected a real corpus, walked ${checked}`);
        // Every difference must be an escape, which is the one behaviour change 0.1.13 makes.
        for (const text of divergent) {
            assert.ok(
                text.includes('\\'),
                `${JSON.stringify(text)} changed meaning without an escape in it`,
            );
        }
    });
});

suite('resolveMacros in the extension host', () => {
    let previousClipboard = '';
    let tempDir: vscode.Uri | undefined;

    setup(async () => {
        // Earlier suites leave both of these dirty; take ownership explicitly.
        previousClipboard = await vscode.env.clipboard.readText();
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
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

    async function openWithContent(content: string): Promise<vscode.TextEditor> {
        const doc = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
        return await vscode.window.showTextDocument(doc);
    }

    test('{{selection}} is the selected text of the active editor', async () => {
        const editor = await openWithContent('alpha\nbeta\ngamma\n');
        editor.selection = new vscode.Selection(1, 0, 1, 4);

        assert.strictEqual(await resolveMacros('>>{{selection}}<<'), '>>beta<<');
    });

    test('a multi-line selection keeps its line breaks', async () => {
        const editor = await openWithContent('alpha\nbeta\ngamma\n');
        editor.selection = new vscode.Selection(0, 0, 2, 0);

        assert.strictEqual(await resolveMacros('{{selection}}'), 'alpha\nbeta\n');
    });

    test('an empty selection expands to nothing', async () => {
        const editor = await openWithContent('alpha\n');
        editor.selection = new vscode.Selection(0, 2, 0, 2);

        assert.strictEqual(await resolveMacros('>>{{selection}}<<'), '>><<');
    });

    test('no active editor expands selection and active_file to nothing', async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        assert.strictEqual(vscode.window.activeTextEditor, undefined);

        assert.strictEqual(await resolveMacros('[{{selection}}][{{active_file}}]'), '[][]');
    });

    test('{{active_file}} is the base name of the active editor', async () => {
        // A real file on disk, so the name is deterministic — an untitled document would
        // be "Untitled-N" with N depending on what earlier suites opened.
        const unique = `prompt-manager-macros-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        tempDir = vscode.Uri.file(path.join(os.tmpdir(), unique));
        await vscode.workspace.fs.createDirectory(tempDir);
        const file = vscode.Uri.joinPath(tempDir, 'target.ts');
        await vscode.workspace.fs.writeFile(file, new TextEncoder().encode('x'));

        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc);

        assert.strictEqual(await resolveMacros('{{active_file}}'), 'target.ts');
    });

    test('{{clipboard}} round-trips through the real clipboard', async () => {
        await vscode.env.clipboard.writeText('PASTED');
        assert.strictEqual(
            await resolveMacros('before {{clipboard}} after'),
            'before PASTED after',
        );
    });

    test('a clipboard holding a macro string is not expanded twice', async () => {
        await vscode.env.clipboard.writeText('literal {{selection}} here');
        assert.strictEqual(await resolveMacros('{{clipboard}}'), 'literal {{selection}} here');
    });

    test('unknown tags survive a real resolve', async () => {
        await vscode.env.clipboard.writeText('C');
        assert.strictEqual(await resolveMacros('{{foo}} {{clipboard}}'), '{{foo}} C');
    });

    test('the snippet text is the only thing mutated: the source file is untouched', async () => {
        const unique = `prompt-manager-macros-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        tempDir = vscode.Uri.file(path.join(os.tmpdir(), unique));
        await vscode.workspace.fs.createDirectory(tempDir);
        const file = vscode.Uri.joinPath(tempDir, 'snippet.md');
        const body = 'Explain {{selection}} from {{active_file}}.\n';
        await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(body));

        const editor = await openWithContent('needle\n');
        editor.selection = new vscode.Selection(0, 0, 0, 6);

        const expanded = await resolveMacros(body);
        assert.ok(expanded?.includes('needle'), 'the macro should have expanded');

        const onDisk = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(file));
        assert.strictEqual(onDisk, body, 'the file on disk must still hold the raw macros');
    });

    test('nothing happens when promptManager.macros.enabled is false', async () => {
        const config = vscode.workspace.getConfiguration('promptManager');
        const previous = config.get<boolean>('macros.enabled');
        await config.update('macros.enabled', false, vscode.ConfigurationTarget.Global);
        try {
            await vscode.env.clipboard.writeText('C');
            assert.strictEqual(await resolveMacros('{{clipboard}}'), '{{clipboard}}');
        } finally {
            await config.update('macros.enabled', previous, vscode.ConfigurationTarget.Global);
        }
    });
});
