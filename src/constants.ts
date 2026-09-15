/**
 * Single source of truth for every identifier that also appears in package.json.
 * TypeScript cannot verify the package.json side, so keep the two in sync by hand.
 */

export const EXT_NS = 'promptManager';
export const VIEW_ID = 'promptManager.view';
export const VIEW_CONTAINER_ID = 'promptManager';

export const Cmd = {
    insertSnippet: 'promptManager.insertSnippet',
    insertFromTree: 'promptManager.insertFromTree',
    copyToClipboard: 'promptManager.copyToClipboard',
    openSnippet: 'promptManager.openSnippet',
    newSnippet: 'promptManager.newSnippet',
    newSnippetHere: 'promptManager.newSnippetHere',
    newFolder: 'promptManager.newFolder',
    renameSnippet: 'promptManager.renameSnippet',
    deleteSnippet: 'promptManager.deleteSnippet',
    openInObsidian: 'promptManager.openInObsidian',
    revealInOS: 'promptManager.revealInOS',
    refresh: 'promptManager.refresh',
    openGlobalFolder: 'promptManager.openGlobalFolder',
    configureInsert: 'promptManager.configureInsertStrategy',
} as const;

/** Values must match the `viewItem` tests in package.json's `view/item/context` menus. */
export const ContextValue = {
    rootGlobal: 'promptRoot.global',
    rootWorkspace: 'promptRoot.workspace',
    folder: 'promptFolder',
    file: 'promptFile',
} as const;

/**
 * Pseudo command id handled inside the inserter rather than dispatched to VS Code.
 * Inserts at the active text editor's cursor.
 */
export const EDITOR_INSERT_TEXT = 'editor.insertText';

/** VS Code's own paste, which writes into whichever text editor holds the focus. */
export const PASTE_ACTION = 'editor.action.clipboardPasteAction';

/**
 * File formats this extension is built around, per its contributed defaults.
 * Used when deciding whether a typed title already carries an extension, so a custom
 * `promptManager.fileExtensions` cannot cause `notes.md` to become `notes.md.md`.
 */
export const SNIPPET_EXTENSIONS = ['.md', '.txt'] as const;

/** Trailing-debounce window for filesystem events, in ms. */
export const WATCH_DEBOUNCE_MS = 250;

/** Debounce before reading a highlighted snippet for the Quick Pick preview, in ms. */
export const PREVIEW_DEBOUNCE_MS = 120;

/** Hard ceiling on entries returned by a recursive scan, to bound a pathological tree. */
export const MAX_SCAN_ENTRIES = 5000;
