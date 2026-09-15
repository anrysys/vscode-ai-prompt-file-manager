# Change Log

All notable changes to the AI Prompt File Manager extension are documented in this file.

## [0.1.10] - 2026-09-15

### Fixed

- **A prompt can no longer overwrite the code it quotes.** Inserting a snippet that
  contains `{{selection}}` could replace the selected code with the expanded prompt, losing
  the code, when the insert strategy included `editor.insertText` or
  `editor.action.clipboardPasteAction`. Those two commands are now skipped for the editor
  the selection was read from, no matter how the strategy is ordered, and the snippet stays
  on the clipboard with a message explaining why. Snippets that do not quote the selection
  still insert as before.
- `editor.action.clipboardPasteAction` is no longer part of the default insert strategy, so
  a fresh install cannot paste a prompt into the file you are looking at. The default is now
  the chat command alone.

## [0.1.8] - 2026-09-15

### Fixed

- **A macro can no longer quote a file you have closed.** The editor remembered for
  `{{selection}}` and `{{active_file}}` is dropped as soon as its document closes, and is
  ignored if it was closed behind the tracker's back. Before this, a snippet inserted after
  closing a tab could carry that tab's text into the prompt without any sign of it.
- **Only real documents can be a macro source.** Diff sides, output channels, search
  results and other generated views are filtered out by URI scheme, so `{{active_file}}` no
  longer reports something like a `git:` diff as the file you are working on.
- **An editor insert lands where the selection came from.** The editor the macros were
  resolved against is threaded through to the insert, so the `editor.insertText` strategy
  replaces that selection even if the focus moved on in between. Both macros are also read
  from a single snapshot, so `{{selection}}` and `{{active_file}}` can no longer disagree
  about which editor they mean.

### Changed

- The tracker is testable in isolation, and the suite now covers the three cases that
  matter: focus in a webview, a closed document, and a virtual document. The 0.1.7 fix
  shipped with no coverage — the existing "no active editor" test passed only because the
  test process loads its own copy of the module.
- README: the tree row description matched neither the tooltip nor the code (a click opens
  the snippet, the insert icon inserts it), and the macro section now states which editor
  the macros read from.

## [0.1.7] - 2026-09-15

### Fixed

- `{{selection}}` and `{{active_file}}` expanded to nothing when the snippet was inserted
  from a chat panel: VS Code reports no active text editor while a webview holds the focus.
  The extension now remembers the last editor you worked in and resolves macros against it.

## [0.1.6] - 2026-09-15

### Fixed

- The hover tooltip claimed "Click to insert, pencil to edit" while a row click actually
  opens the snippet and the inline icon inserts it. The tooltip now matches the behaviour.

## [0.1.5] - 2026-09-15

### Changed

- **One name everywhere.** The view container, the command category, the settings section
  and the output channel now read *AI Prompt File Manager* instead of *Prompt Manager*,
  matching the Marketplace listing. Setting keys, command ids and keybindings are unchanged.
- **The README no longer repeats the Marketplace header.** The extension page draws its own
  icon, title and description from the manifest, so the duplicate heading and the logo image
  at the top of the README have been removed. The page now shows the name once and the logo
  once.

### Fixed

- Two unrelated image files in the repository root were being shipped inside the `.vsix`.
  They are now excluded from the package.

## [0.1.4] - 2026-09-15

### Added

- **Context macros.** Snippet text is now expanded before it reaches the clipboard or the
  editor: `{{selection}}` becomes the text selected in the active editor, `{{active_file}}`
  its file name, and `{{clipboard}}` the current clipboard contents. Applies to Insert
  Snippet, the tree insert action and Copy to Clipboard. The snippet file on disk is never
  modified — only the in-memory copy.
- Anything else in double braces, such as `{{foo}}`, is left exactly as written, so prompts
  containing Jinja or Handlebars syntax are unaffected. Expansion is single-pass, so a
  macro-looking string pulled in by `{{clipboard}}` is not expanded again.
- `promptManager.macros.enabled` (default `true`) turns macro expansion off.

### Changed

- **Copy to Clipboard no longer wipes the clipboard when there is nothing to copy.** It now
  warns and leaves the clipboard alone, matching what Insert Snippet already did. The empty
  check runs after macro expansion, so a snippet whose macros all resolve to empty is
  caught too, with wording that distinguishes it from an empty file.

## [0.1.0] - 2026-09-13

Initial release.

- Quick Pick insert across Global and Workspace scopes, bound to `Ctrl+Alt+P`.
- Snippet bodies are always read fresh from disk; nothing is cached.
- Tree view in the Activity Bar with create, rename, delete and reveal actions.
- Recursive subfolder support in both the tree and the Quick Pick.
- Configurable, gracefully degrading insert strategy on top of a guaranteed clipboard copy.
- Configurable Obsidian URI template with `{absolutePath}`, `{relativePath}` and `{vault}`.
- Debounced file watching, including for folders outside the workspace.
