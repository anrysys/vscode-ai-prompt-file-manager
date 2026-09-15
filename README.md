# AI Prompt File Manager

Keep your AI prompts as ordinary `.md` / `.txt` files, find them with a keystroke, and get
them into a chat panel without hunting through folders.

The file system is the single source of truth. There is no hidden database and no in-memory
cache of snippet bodies: a snippet is read from disk at the moment you insert it, so what
you paste is always what is on disk right now. Point the global folder at your Obsidian
vault and the same files serve both tools.

## Features

- **Quick insert** — `Ctrl+Alt+P` opens a searchable list of every snippet across both
  scopes, with scope badges and subfolder paths. Picking one copies it to the clipboard.
- **Two scopes** — *Global* snippets follow you between projects; *Workspace* snippets live
  in the repo (`.vscode/prompts` by default) and can be committed with it.
- **Nested folders** — organise snippets into subfolders; they appear as groups in the tree
  and as a path in the Quick Pick, so search still finds everything.
- **Context macros** — snippets are templates. `{{selection}}`, `{{active_file}}` and
  `{{clipboard}}` are filled in from your editor as the snippet is copied or inserted, and
  keep working when the focus has already moved into a chat panel. The file on disk is
  never modified.
- **Interactive variables** — `{{?Language}}` asks you for a value on the way through, and
  `{{?Language:Rust|Go|Python}}` offers a list to pick from. One template covers the cases
  you would otherwise keep as separate files.
- **Tree view** — an AI Prompt File Manager container in the Activity Bar with create, rename,
  delete and reveal actions. Clicking a row opens the snippet for editing; the insert icon
  on the right of the row sends it to the chat.
- **Hover to preview** — hovering a snippet shows the start of its text, read on demand so
  that building the tree never touches file contents. Long prompts are clipped to 15 lines.
- **Open in Obsidian** — jump from a snippet to the same file in your vault.
- **Live refresh** — the tree follows changes made outside VS Code.

## Context Variables (Macros)

Turn your prompts into dynamic templates. When you insert a snippet, the extension can automatically inject live context from your editor into the prompt text before it goes to the clipboard or chat.

Support macros (use double curly braces):
- `{{selection}}` — Injects the highlighted text from the editor you were last working in. Perfect for *"Refactor this code: {{selection}}"*.
- `{{active_file}}` — Injects the file name of that same editor.
- `{{clipboard}}` — Injects whatever is currently in your clipboard.

Some prompts need a value only you can supply. Interactive variables ask for it as the snippet goes out:
- `{{?Language}}` — Opens an input box. `{{?Language=Rust}}` opens it pre-filled.
- `{{?Language:Rust|Go|Python}}` — Opens a list to pick from, so you stop retyping the same word.

So `Rewrite this in {{?Language}}: {{selection}}` is one file that covers every language you use. Press `Esc` and the whole insert is called off, clipboard included.

*Note: Unknown tags like `{{vue_variable}}` are ignored and passed through literally, so your code prompts won't break.*

## Universal Compatibility

This extension acts as a universal bridge for your prompts. Because it relies on standard file formats and native clipboard operations, it **works perfectly with absolutely any AI agent or IDE**:

- Claude Code, Claude Desktop, Cursor, Antigravity, Codex, Windsurf
- VS Code, JetBrains AI, Warp, Zed
- Gemini CLI, Cline, Qoder, Kimi, Trae
- ...and every other program where you can paste text.

## Getting started

1. Open the **AI Prompt File Manager** view in the Activity Bar.
2. Press **New Snippet**, choose a scope, and give it a title. The file is created and
   opened for editing; the folder is created for you if it does not exist.
3. Press `Ctrl+Alt+P` (`Cmd+Alt+P` on macOS) anywhere, pick the snippet, and paste.

From the tree, a single click on a snippet opens it for editing; the insert icon on the
right of the row inserts it. Both actions are also listed by name in the right-click menu.

A title may contain `/` to nest: `review/security` creates `review/security.md`.

## What actually gets inserted where

VS Code isolates extension code from other extensions' webviews. That has a concrete
consequence worth stating plainly:

| Target | What works |
|---|---|
| GitHub Copilot Chat | Can be **prefilled** via `workbench.action.chat.open`, which puts the snippet in the input without sending it. |
| Quick Chat | Can be prefilled via `workbench.action.openQuickChat`. |
| A normal text editor | Can be pasted or inserted at the cursor. |
| Claude Code, Antigravity, and other chat webviews | **No API can type into them.** Their focus commands ignore arguments. |

So the snippet is **always copied to the clipboard first**, and only then does the extension
make a best-effort attempt at a real insertion. If nothing can insert it, `Ctrl+V` still
works — that is the guarantee.

What happens after the copy is two checkboxes, not a list of command ids:

| Setting | Default | What it does |
|---|---|---|
| `promptManager.insert.pasteIntoChatPanel` | `true` | Pre-fills the Copilot / Quick Chat input without submitting. |
| `promptManager.insert.pasteIntoEditor` | `false` | **Writes into your active editor, replacing the selection.** Off unless you ask for it. |

The second guarantee is that a prompt never eats the code it quotes. If a snippet contains
`{{selection}}`, nothing writes into the editor that selection came from — not the editor
paste, not `pasteIntoEditor`, whatever your settings say. You get the prompt on the
clipboard and a message saying why, instead of your function replaced by a prompt about
your function.

Set both toggles from **AI Prompt File Manager: Configure Insert Behavior...**, or in
Settings. For a chat panel that cannot be typed into, set
`promptManager.insert.focusCommand` (for example `claude-vscode.focus` or
`antigravity.panel.focus`) to focus its input so you can paste immediately.

`promptManager.insert.strategy`, the old ordered list of raw command ids, is deprecated. A
value you already set still wins so nothing changes under you; running **Configure Insert
Behavior...** clears it and moves you to the toggles.

One caveat the notification wording reflects: a chat command with no chat provider
installed resolves successfully while doing nothing, and that is not detectable. The
message therefore says *"Copied ... , ran &lt;command&gt;"* rather than claiming the text
was inserted.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `promptManager.global.path` | *(extension storage)* | Global snippet folder. Supports `~`, `${userHome}`, `${env:NAME}`. Point it at your Obsidian vault. |
| `promptManager.workspace.path` | `.vscode/prompts` | Workspace snippet folder, per workspace folder. |
| `promptManager.global.enabled` / `workspace.enabled` | `true` | Show or hide a scope. |
| `promptManager.fileExtensions` | `[".md", ".txt"]` | Which files count as snippets. |
| `promptManager.newSnippet.extension` | `.md` | Extension for newly created snippets. |
| `promptManager.excludeGlobs` | `node_modules`, `.git`, `.obsidian` | Subfolders to skip. |
| `promptManager.maxDepth` | `8` | Subfolder nesting depth to scan. |
| `promptManager.maxFileSizeKb` | `512` | Refuse to read snippets larger than this. |
| `promptManager.quickPick.showPreview` | `true` | Preview the highlighted snippet in the Quick Pick. |
| `promptManager.macros.enabled` | `true` | Expand `{{selection}}`, `{{active_file}}`, `{{clipboard}}` and the interactive `{{?Name}}` variables in snippet text. |
| `promptManager.insert.pasteIntoChatPanel` | `true` | Pre-fill the Copilot / Quick Chat input after copying. |
| `promptManager.insert.pasteIntoEditor` | `false` | Write into the active editor, replacing its selection. Never applies to the editor a `{{selection}}` was read from. |
| `promptManager.insert.strategy` | *(unset)* | **Deprecated** ordered list of raw command ids. Still honoured while set. |
| `promptManager.insert.focusCommand` | *(empty)* | Command that focuses a chat input when nothing could insert. |
| `promptManager.insert.treatAsSnippet` | `false` | Interpret `$1` / `${1:name}` as tabstops when inserting into an editor. |
| `promptManager.insert.notification` | `statusBar` | `statusBar`, `toast` or `none`. |
| `promptManager.obsidian.uriTemplate` | `obsidian://open?path={absolutePath}` | Placeholders: `{absolutePath}`, `{relativePath}`, `{vault}`. |
| `promptManager.obsidian.vaultName` | *(empty)* | Vault name for `{vault}`. |

`global.path` and `obsidian.vaultName` are machine-scoped, so a cloned repository cannot
retarget your global prompt folder through its committed settings.

### Obsidian

The default template lets Obsidian work out which vault contains the file. To address a
named vault instead:

```json
"promptManager.obsidian.uriTemplate": "obsidian://open?vault={vault}&file={relativePath}",
"promptManager.obsidian.vaultName": "My Vault"
```

A file name containing `#`, `?` or `&` cannot be expressed in an Obsidian URI, because
VS Code re-encodes external URIs on the way out. The extension detects this and offers to
copy the URI instead of opening a wrong file.

## Context macros

Snippet text is expanded on its way to the clipboard or editor. The snippet file itself is
never rewritten — only the copy in memory.

| Macro | Expands to |
|---|---|
| `{{selection}}` | Text selected in the source editor, or empty if there is no selection. |
| `{{active_file}}` | File name of the source editor, for example `extension.ts`. |
| `{{clipboard}}` | The current clipboard contents. |

So a snippet containing

```
Explain this code from {{active_file}}:

{{selection}}
```

turns into a complete prompt the moment you insert it.

Details worth knowing:

- **Anything else in double braces is left exactly as written.** `{{foo}}` stays `{{foo}}`,
  so prompts that discuss Jinja, Handlebars or Mustache templates survive intact. Names are
  case sensitive, and inner spaces are fine: `{{ selection }}` works.
- **Expansion happens once.** If your clipboard happens to contain the text
  `{{selection}}`, it is pasted in literally rather than expanded a second time.
- **The hover preview and Quick Pick preview show the raw text**, macros and all. They read
  the file as written; only the insert and copy commands expand.
- **The source editor is the active one, or the last one you worked in.** By the time you
  trigger an insert the focus is often already inside a chat panel, where VS Code reports no
  active editor at all; falling back to the last real editor is what keeps `{{selection}}`
  from silently expanding to nothing. Only ordinary documents qualify — diff sides, output
  channels, search results and other generated views are never used — and the fallback is
  dropped the moment its document is closed, so a macro never quotes a file you cannot see.
- **`{{selection}}` reads the primary selection**, and the editor it came from is then off
  limits to the writing strategies, so the prompt cannot replace the code it quotes. An
  `editor.insertText` strategy still writes into that editor for snippets that do not use
  `{{selection}}`.
- **`{{clipboard}}` in a snippet you *copy* is self-referential**: copying it twice in a row
  nests the previous result. Fine once, surprising twice.
- If everything in a snippet resolves to empty, the extension says so and leaves your
  clipboard alone rather than wiping it.

Set `promptManager.macros.enabled` to `false` to turn all of this off.

## Interactive variables

The macros above read your editor. Interactive variables read *you*: they open a dialog as the
snippet is on its way out, and substitute what you answer.

| Form | What you get |
|---|---|
| `{{?Language}}` | An input box, empty. |
| `{{?Language=Rust}}` | An input box, pre-filled with `Rust`. |
| `{{?Language:Rust\|Go\|Python}}` | A list to pick from. |

So a snippet containing

```
Rewrite this code in {{?Language}} using {{?Framework}}:

{{selection}}
```

asks two short questions and hands the finished prompt to your chat. One file replaces the dozen
near-identical ones you would otherwise keep.

Options are separated by `|` rather than a comma, because option text contains commas.

Details worth knowing:

- **`Esc` cancels the whole insert, at any step.** Not the current question — the insert. Nothing
  has been written when you press it, and that includes your clipboard, which still holds whatever
  it held before. A half-filled prompt is worse than no prompt.
- **Each name is asked once**, in the order it first appears, and the answer fills every
  occurrence. `{{?Lang}}` three times is one question. The dialog title counts the questions
  (`(2/3)`) so three in a row do not read as a freeze.
- **A name may be mentioned before it is defined.** `Use {{?Lang}} … Target: {{?Lang:Rust|Go}}`
  asks once, with the list — the definition wins wherever you put it.
- **Clicking elsewhere does not discard what you typed.** The dialogs stay open until you answer
  or cancel, so you can go and look something up mid-prompt. One consequence worth knowing: if you
  select code while a dialog is open, the extension will not write the prompt into your editor,
  because the selection you made is not the one you triggered the insert on. It goes to the
  clipboard instead and the status bar says so.
- **`{{selection}}` is read before the first question**, not after the last, so the code you had
  highlighted when you triggered the insert is the code that ends up in the prompt.
- **A malformed variable is left exactly as written**, like any unknown tag. `{{?}}` and
  `{{?Name:}}` (a colon promising options but listing none) travel through untouched, so you see
  them in the output and can fix the file. Note that `{{?Lang|Rust|Go}}` — a forgotten colon — is
  malformed for the same reason and passes through silently.
- **Names may contain spaces and non-Latin letters**, so `{{?Target language}}` and `{{?Язык}}`
  both work. They are case sensitive.
- Interactive variables obey `promptManager.macros.enabled` along with everything else, and the
  hover and Quick Pick previews never prompt — they show the raw text.

### Showing a macro without expanding it

Put a backslash in front of it:

| You write | You get |
|---|---|
| `\{{selection}}` | `{{selection}}` |
| `\{{?Language}}` | `{{?Language}}` |
| `\{{foo}}` | `\{{foo}}` — unchanged, because `{{foo}}` was never a macro |

The backslash disappears only where it actually suppressed an expansion, so adding it to a prompt
that has no macros in it changes nothing. Backslashes anywhere else — Windows paths, LaTeX, regex —
are left alone.

The one thing this cannot express is a literal backslash immediately followed by an expanding
macro: `C:\{{selection}}` gives you `C:{{selection}}`, not `C:` plus the selection. Put a character
between them if you need both.

## Known limitations

- The tree follows on-disk changes through a file watcher. VS Code applies
  `files.watcherExclude` to it, and some network or virtual file systems emit no events at
  all — the **Refresh** button in the view title always works.
- On a remote or WSL window, `workspace.fs` and the default global storage resolve on the
  **remote** host, so the global prompt folder lives remote-side.

## Requirements

VS Code 1.99 or newer.
