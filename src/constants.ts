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
    // Resource-level clipboard, distinct from `copyToClipboard`, which copies a snippet's
    // *text*. The two would be indistinguishable in the palette under the same verb.
    cutResource: 'promptManager.cutResource',
    copyResource: 'promptManager.copyResource',
    pasteResource: 'promptManager.pasteResource',
    duplicateResource: 'promptManager.duplicateResource',
} as const;

/** Values must match the `viewItem` tests in package.json's `view/item/context` menus. */
export const ContextValue = {
    rootGlobal: 'promptRoot.global',
    rootWorkspace: 'promptRoot.workspace',
    folder: 'promptFolder',
    file: 'promptFile',
} as const;

/**
 * VS Code's convention for a tree's own drag payload is
 * `application/vnd.code.tree.<view id, lowercased>`. Derived rather than written out, so
 * renaming VIEW_ID cannot silently stop drops from being recognised.
 */
export const TREE_MIME_TYPE = `application/vnd.code.tree.${VIEW_ID.toLowerCase()}`;

/** Mime type carrying dropped resources from outside this tree. */
export const URI_LIST_MIME_TYPE = 'text/uri-list';

/** Mime type carrying dropped OS files, which may have no path at all on web. */
export const FILES_MIME_TYPE = 'files';

/** Context keys pushed with `setContext`; mirrored in package.json `when` clauses. */
export const ContextKey = {
    clipboardHasItems: 'promptManager.clipboardHasItems',
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
