# Change Log

All notable changes to the Prompt Manager extension are documented in this file.

## [0.1.0] - 2026-09-13

Initial release.

- Quick Pick insert across Global and Workspace scopes, bound to `Ctrl+Alt+P`.
- Snippet bodies are always read fresh from disk; nothing is cached.
- Tree view in the Activity Bar with create, rename, delete and reveal actions.
- Recursive subfolder support in both the tree and the Quick Pick.
- Configurable, gracefully degrading insert strategy on top of a guaranteed clipboard copy.
- Configurable Obsidian URI template with `{absolutePath}`, `{relativePath}` and `{vault}`.
- Debounced file watching, including for folders outside the workspace.
