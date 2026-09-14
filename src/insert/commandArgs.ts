import { EDITOR_INSERT_TEXT } from '../constants';

export interface CommandInvocation {
    readonly commandId: string;
    readonly args: readonly unknown[];
}

/**
 * Commands verified against the running VS Code build as genuinely accepting snippet
 * text. Anything not listed here is still dispatchable; it just receives a bare string.
 */
export const KNOWN_INSERT_COMMANDS: readonly { id: string; detail: string }[] = [
    {
        id: 'workbench.action.chat.open',
        detail: 'Prefill the chat input without submitting (needs a chat provider)',
    },
    {
        id: 'workbench.action.quickchat.toggle',
        detail: 'Prefill Quick Chat without submitting',
    },
    {
        id: 'workbench.action.openQuickChat',
        detail: 'Open Quick Chat with the snippet as its query',
    },
    {
        id: EDITOR_INSERT_TEXT,
        detail: 'Insert at the cursor of the active text editor (this extension)',
    },
    {
        id: 'editor.action.clipboardPasteAction',
        detail: 'Paste into a focused text editor (cannot reach chat webviews)',
    },
];

/**
 * Command ids that look plausible but cannot carry text, so they must never appear in
 * the insert strategy. They belong in `promptManager.insert.focusCommand` instead.
 */
export const NON_TEXT_COMMANDS: readonly string[] = [
    // Titled "Move Chat into Side Bar" — relocates the panel, takes no query.
    'workbench.action.chat.openInSidebar',
    // Both act on the current editor selection and ignore their arguments entirely.
    'claude-vscode.focus',
    'antigravity.insertSnippet',
];

const PARTIAL_QUERY_COMMANDS = new Set([
    'workbench.action.chat.open',
    'workbench.action.chat.openAgent',
    'workbench.action.chat.openAsk',
    'workbench.action.chat.openEdit',
    'workbench.action.quickchat.toggle',
]);

const BARE_STRING_COMMANDS = new Set(['workbench.action.openQuickChat']);

/** Commands driven entirely by the clipboard, which is already populated by the time we run. */
const NO_ARG_COMMANDS = new Set(['editor.action.clipboardPasteAction']);

/**
 * Maps a command id to the exact argument list VS Code expects for it.
 * Unknown ids get `[text]`, which is the most common third-party convention.
 */
export function buildInvocation(commandId: string, text: string): CommandInvocation {
    if (PARTIAL_QUERY_COMMANDS.has(commandId)) {
        // isPartialQuery keeps the prompt in the input box instead of submitting it.
        return { commandId, args: [{ query: text, isPartialQuery: true }] };
    }
    if (BARE_STRING_COMMANDS.has(commandId)) {
        return { commandId, args: [text] };
    }
    if (NO_ARG_COMMANDS.has(commandId)) {
        return { commandId, args: [] };
    }
    return { commandId, args: [text] };
}
