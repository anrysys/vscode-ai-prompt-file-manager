import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { EDITOR_INSERT_TEXT, PASTE_ACTION } from '../constants';
import { getInsertConfig, getInsertToggles } from '../config/configuration';
import {
    CHAT_PANEL_COMMANDS,
    EDITOR_COMMANDS,
    insertSnippetText,
    planStrategy,
} from '../insert/inserter';

/**
 * The settings are two booleans, and the command ids live in the code. These suites pin
 * down the mapping between them, because that mapping is the whole reason a user can no
 * longer configure their own editor into being overwritten.
 */

suite('planStrategy', () => {
    test('both toggles off means the clipboard and nothing else', () => {
        assert.deepStrictEqual(
            planStrategy({ pasteIntoChatPanel: false, pasteIntoEditor: false }),
            [],
        );
    });

    test('the chat toggle maps to the chat commands only', () => {
        const plan = planStrategy({ pasteIntoChatPanel: true, pasteIntoEditor: false });

        assert.deepStrictEqual(plan, [...CHAT_PANEL_COMMANDS]);
        assert.ok(!plan.includes(EDITOR_INSERT_TEXT), 'must not reach into the editor');
    });

    test('the editor toggle maps to the extension command, never to a raw paste', () => {
        const plan = planStrategy({ pasteIntoChatPanel: false, pasteIntoEditor: true });

        assert.deepStrictEqual(plan, [...EDITOR_COMMANDS]);
        // The raw paste action writes wherever the focus happens to be, which is what made
        // the old free-form setting dangerous. No toggle can turn it back on.
        assert.ok(!plan.includes(PASTE_ACTION));
    });

    test('with both on, chat is tried before anything touches a document', () => {
        const plan = planStrategy({ pasteIntoChatPanel: true, pasteIntoEditor: true });

        assert.ok(plan.indexOf(CHAT_PANEL_COMMANDS[0]!) < plan.indexOf(EDITOR_INSERT_TEXT));
    });
});

suite('getInsertConfig reads the toggles', () => {
    const section = () => vscode.workspace.getConfiguration('promptManager');
    const KEYS = [
        'insert.pasteIntoChatPanel',
        'insert.pasteIntoEditor',
        'insert.strategy',
    ] as const;
    let saved: Record<string, unknown> = {};

    setup(async () => {
        // The suite owns these keys outright: a value left over from the host profile
        // would decide the assertions instead of the test.
        saved = {};
        for (const key of KEYS) {
            saved[key] = section().inspect(key)?.globalValue;
            await section().update(key, undefined, vscode.ConfigurationTarget.Global);
        }
    });

    teardown(async () => {
        for (const key of KEYS) {
            await section().update(key, saved[key], vscode.ConfigurationTarget.Global);
        }
    });

    test('the defaults are chat only: nothing writes into a document', () => {
        assert.deepStrictEqual(getInsertConfig().strategy, [...CHAT_PANEL_COMMANDS]);
        assert.deepStrictEqual(getInsertToggles(), {
            pasteIntoChatPanel: true,
            pasteIntoEditor: false,
        });
    });

    test('turning the editor toggle on adds the editor command', async () => {
        await section().update('insert.pasteIntoEditor', true, vscode.ConfigurationTarget.Global);

        assert.deepStrictEqual(getInsertConfig().strategy, [
            ...CHAT_PANEL_COMMANDS,
            EDITOR_INSERT_TEXT,
        ]);
    });

    test('turning both off leaves the clipboard as the only outcome', async () => {
        await section().update('insert.pasteIntoChatPanel', false, vscode.ConfigurationTarget.Global);
        const cfg = getInsertConfig();
        assert.deepStrictEqual(cfg.strategy, []);

        const outcome = await insertSnippetText('body for the clipboard', cfg);

        // Requirement that outranks every toggle: the copy always happens.
        assert.strictEqual(outcome.kind, 'clipboardOnly');
        assert.strictEqual(await vscode.env.clipboard.readText(), 'body for the clipboard');
    });

    test('a still-set deprecated strategy wins, so upgrades change nothing silently', async () => {
        await section().update(
            'insert.strategy',
            ['workbench.action.quickchat.toggle'],
            vscode.ConfigurationTarget.Global,
        );

        assert.deepStrictEqual(getInsertConfig().strategy, ['workbench.action.quickchat.toggle']);
    });
});
