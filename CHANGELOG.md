# Change Log

All notable changes to the Prompt Manager extension are documented in this file.

## [Unreleased]

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
