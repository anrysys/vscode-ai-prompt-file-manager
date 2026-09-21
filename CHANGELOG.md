# Change Log

All notable changes to the AI Prompt File Manager extension are documented in this file.

## [0.4.0] - 2026-09-21

### Added

- **The scope rows can be dragged out.** Dragging Global Prompts or Workspace Prompts into an
  editor drops in the folder's path, so a chat panel that takes file attachments can be handed
  the whole prompt library in one gesture. They still cannot be dragged *anywhere*: a scope is
  a setting that names a directory, so the tree will not move it. A scope whose folder has not
  been created yet is not offered at all, rather than handing out a path to nothing.
- Dragging several rows out at once now has a test pinning the exact payload, so a multi-row
  drag is guaranteed to arrive as one line per row.

### Fixed

- **Dragging a prompts folder onto the other scope moved it.** The folder a scope points at
  counts as being inside itself, so dropping it in from the Explorer — or from Finder or your
  file manager — was read as an ordinary move between scopes and relocated the entire
  directory, while the setting went on pointing at the empty place it used to be. Every move,
  copy and import now refuses a source that is a configured prompts folder, and says why.

## [0.3.0] - 2026-09-20

### Added

- **Paths can be copied straight out of the tree.** **Copy Path** gives the absolute location
  in your system's own separators, ready to paste into a shell; **Copy Relative Path** gives
  the path from the prompt folder down, always with forward slashes, so it still means
  something on the next machine the prompt travels to. Both work on files, folders and the
  Global and Workspace rows themselves. Select several rows and you get one path per line, in
  the order the tree shows them — including a file and the folder it sits in, which are two
  separate answers to "where is this?" and are copied as two.
- **Folders open in a terminal.** **Open in Integrated Terminal** starts a shell already in
  the folder you right-clicked. It is VS Code's own terminal rather than a system console, so
  it behaves the same on a remote, WSL or container window, where the folder does not exist
  on your local disk at all. A scope folder that has not been created yet is created first,
  rather than handing you a shell that cannot start. Selecting a file alongside a folder opens
  one terminal, for the folder.

### Changed

- **Copy Path is the one tree command that takes over the system clipboard.** Cut and Copy
  still keep their own buffer, so rearranging files cannot overwrite a prompt on its way to a
  chat — but a path is exactly what Copy Path was asked for, so it replaces whatever was
  there.
- The right-click menu now orders its groups the way the Explorer does: Cut/Copy/Paste and
  Duplicate, then the two path commands, then Rename and Delete.

## [0.2.1] - 2026-09-20

### Changed

- **The Marketplace icon is calmer and larger.** The mark now fills about 72% of the plate
  instead of 55%, so it reads at the ~42px the Extensions list gives it. The neon green
  and yellow-amber are gone: the bubble is a restrained emerald, the bolt a proper orange,
  and the flat black plate is a slate-charcoal gradient that reads as a surface rather than
  a hole on both light and dark Marketplace themes. The Activity Bar icon is unchanged — VS
  Code renders it as a single-colour mask at codicon size, so neither the colour nor the
  scale change applies there.

## [0.2.0] - 2026-09-20

### Added

- **The Quick Pick learns which prompts you actually use.** The ones you reach for most are
  listed under a **Frequently used** group at the top, across both scopes, so the prompt you
  want is usually the first thing you see. Counts are local to the machine and never synced —
  which prompts someone reaches for is a habit formed at one keyboard, not a setting worth
  replicating. `promptManager.quickPick.frequentCount` sets how many to show (5 by default,
  0 hides the group entirely). A prompt you have never used is never padded into the group.
- **The tree view is now a file manager.** Drag snippets and folders onto any folder, at any
  depth, including between the Global and Workspace scopes. Select several rows and move,
  copy or delete them in one gesture. **Cut**, **Copy**, **Paste** and **Duplicate** joined
  the right-click menu, bound to the usual keys while the view has focus, alongside `F2` to
  rename and `Delete` to delete.
- **Files can be dragged in from outside.** Dropping a `.md` or `.txt` from the Explorer or
  the desktop copies it into the prompt folder; the original is never moved. Anything that
  is not a prompt is skipped with a message rather than landing on disk invisibly.
- **Snippets can be dragged out** into an editor, which inserts a link to the file.

### Changed

- A name clash on a move, copy or import suffixes the incoming item `-2` rather than
  overwriting, matching what creating a snippet has always done. Deletions still go to the
  OS trash, and a multiple delete lists every full path before it asks.
- Usage counts follow a snippet through a move, a drag or a paste, as they already did
  through a rename — including when a clash renamed the file on arrival.

### Fixed

- **Renaming could write outside the prompt folder.** A name containing `..` was normalised
  into a path that escaped the root. The input box already rejected separators, but the
  repository now refuses any rename that would change the parent directory, so the guard no
  longer depends on its caller.
- Moving a snippet between two different disks no longer fails: the move falls back to a
  copy and delete when the file system cannot rename across devices.

## [0.1.13] - 2026-09-15

### Added

- **Interactive variables: prompts can ask you for a value.** `{{?Language}}` opens an input
  box on the way to the chat, `{{?Language=Rust}}` opens it pre-filled, and
  `{{?Language:Rust|Go|Python}}` offers a list to pick from. So
  `Rewrite this in {{?Language}}: {{selection}}` is one file instead of the dozen
  near-identical ones it replaces. Each name is asked once, in the order it first appears, and
  the answer fills every occurrence; where a name is mentioned bare in one place and defined
  with a list in another, the definition wins.
- **Escaping.** A backslash in front of a macro shows it instead of expanding it:
  `\{{selection}}` inserts the literal text `{{selection}}`, which is what a prompt *about*
  this extension needs. The backslash is consumed only where it actually suppressed an
  expansion — `\{{foo}}` stays `\{{foo}}`, because `{{foo}}` was never a macro — so adding the
  escape to a prompt that contains no macros cannot change it.

### Changed

- **`Esc` during an interactive variable cancels the entire insert**, at any step, and leaves
  no trace: no partial prompt, and in particular no clipboard write. The clipboard still holds
  whatever it held before. Every answer is collected before anything is written anywhere.
- **The prompt cannot land on a selection you made while a dialog was open.** An input box
  stays open for as long as you like — deliberately, so a stray click cannot discard what you
  typed — which means you can highlight code in the editor while one is up. If you do, the
  editor-writing strategies are skipped and the snippet goes to the clipboard, because the
  range it would overwrite is not the one you triggered the insert on. The status bar says so.
  This is the 0.1.9 guard extended to cover the pause this release introduces.
- `{{selection}}` and `{{active_file}}` are now read *before* the first dialog rather than
  after the last, so the code you had highlighted when you triggered the insert is the code
  that reaches the prompt.
- A snippet that expands to nothing because you answered every variable with empty text now
  says so, instead of reporting that its macros resolved to empty.

### Fixed

- `{{\u00A0selection}}` and friends stay literal. The macro body is matched against ASCII
  space and tab only, so a non-breaking space pasted in from Word, Notion or a chat client
  cannot turn text that has always been literal into a working macro. The same applies to
  U+2028 and U+2029, which are line separators that a plain `\r\n` check misses.

### Unchanged

- The clipboard copy still happens first, unconditionally, whatever the toggles say — except
  when the insert is cancelled, which happens before any of it runs.
- Expansion is still a single pass, so a value containing `{{selection}}` is inserted
  literally rather than expanded a second time. That now covers what you type into an input
  box as well.
- Anything else in double braces is still left exactly as written, and the hover and Quick
  Pick previews still show the raw file, macros and all. They never prompt.

## [0.1.12] - 2026-09-15

### Changed

- **The Activity Bar icon is now the product's own mark** — the speech bubble with the
  lightning bolt — instead of the generic "file with a `>` prompt" glyph. It is drawn as a
  single-colour line icon at codicon weight so it sits correctly beside Explorer, Search and
  SCM. It cannot be green and orange there: VS Code renders view-container icons as a CSS
  mask, which discards colour and tints the shape with `activityBar.foreground`.
- **The Marketplace icon has been redrawn** from the same geometry, in colour. The
  "PROMPT MANAGER / DEVELOPER TOOL" lettering is gone — it was unreadable at the ~42px the
  Extensions list actually renders the icon at — and the dark plate now fills the whole
  canvas, so the icon no longer sits inside an opaque white border on dark themes.
- Logo and Activity Bar icon are one shape at two scales, so the editor and the Marketplace
  now show the same mark.

### Added

- `resources/logo.svg` — the editable colour master that `icon.png` is rendered from. It is
  excluded from the packaged extension.

## [0.1.11] - 2026-09-15

### Changed

- **Insert behaviour is two checkboxes instead of a list of command ids.**
  `promptManager.insert.pasteIntoChatPanel` (on by default) pre-fills the Copilot or Quick
  Chat input; `promptManager.insert.pasteIntoEditor` (off by default) writes into the
  active editor and says so in its description. The command ids each one stands for now
  live in the extension, where they are covered by tests.
- **Configure Insert Strategy...** is now **Configure Insert Behavior...** and offers the
  same two choices in plain words, with a warning on the one that writes into code. It also
  clears the deprecated setting for you.
- `promptManager.insert.strategy` is deprecated. A value you have already set still wins, so
  upgrading changes nothing silently; the settings UI now marks it as superseded.
- The raw `editor.action.clipboardPasteAction` is no longer reachable from configuration at
  all. It pasted into whichever editor held the focus, which is what made the old setting
  able to overwrite the wrong file.

### Unchanged

- The clipboard copy still happens first, unconditionally, whatever the toggles say.
- The guard from 0.1.9 is intact: a snippet quoting `{{selection}}` is never written back
  over that selection.

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
