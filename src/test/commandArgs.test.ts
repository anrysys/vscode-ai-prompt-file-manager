import * as assert from 'node:assert';
import { buildInvocation, KNOWN_INSERT_COMMANDS, NON_TEXT_COMMANDS } from '../insert/commandArgs';

suite('buildInvocation', () => {
    const text = 'review this diff\nline two';

    test('chat.open gets a partial query so the prompt is not submitted', () => {
        assert.deepStrictEqual(buildInvocation('workbench.action.chat.open', text), {
            commandId: 'workbench.action.chat.open',
            args: [{ query: text, isPartialQuery: true }],
        });
    });

    test('quickchat.toggle takes the same object shape', () => {
        assert.deepStrictEqual(buildInvocation('workbench.action.quickchat.toggle', text), {
            commandId: 'workbench.action.quickchat.toggle',
            args: [{ query: text, isPartialQuery: true }],
        });
    });

    test('openQuickChat takes a bare string', () => {
        assert.deepStrictEqual(buildInvocation('workbench.action.openQuickChat', text), {
            commandId: 'workbench.action.openQuickChat',
            args: [text],
        });
    });

    test('the paste action takes no arguments, since it reads the clipboard', () => {
        assert.deepStrictEqual(buildInvocation('editor.action.clipboardPasteAction', text), {
            commandId: 'editor.action.clipboardPasteAction',
            args: [],
        });
    });

    test('an unknown command falls back to a bare string', () => {
        assert.deepStrictEqual(buildInvocation('some.third.party.command', text), {
            commandId: 'some.third.party.command',
            args: [text],
        });
    });

    test('the mode-specific chat commands keep the partial query shape', () => {
        for (const id of [
            'workbench.action.chat.openAgent',
            'workbench.action.chat.openAsk',
            'workbench.action.chat.openEdit',
        ]) {
            assert.deepStrictEqual(
                buildInvocation(id, text).args,
                [{ query: text, isPartialQuery: true }],
                `${id} should carry a partial query`,
            );
        }
    });

    test('commands known not to carry text are never advertised as insert options', () => {
        const advertised = new Set(KNOWN_INSERT_COMMANDS.map((c) => c.id));
        for (const id of NON_TEXT_COMMANDS) {
            assert.ok(!advertised.has(id), `${id} must not be offered as an insert command`);
        }
    });
});
