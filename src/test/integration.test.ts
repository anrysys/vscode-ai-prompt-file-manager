import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Cmd, ContextValue, VIEW_ID } from '../constants';
import { SnippetRepository } from '../fs/repository';
import { PromptTreeProvider } from '../tree/promptTreeProvider';
import { insertSnippetText } from '../insert/inserter';
import { TOOLTIP_MAX_LINES, TRUNCATION_NOTICE } from '../tree/tooltip';
import type { InsertConfig } from '../config/configuration';

const EXTENSION_ID = 'anrysys.text-to-ai-chat';

suite('extension wiring', () => {
    test('the extension is present and activates', async () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(ext, `${EXTENSION_ID} should be installed in the test host`);
        await ext.activate();
        assert.strictEqual(ext.isActive, true);
    });

    test('every contributed command is actually registered', async () => {
        await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
        const registered = new Set(await vscode.commands.getCommands(true));
        for (const id of Object.values(Cmd)) {
            assert.ok(registered.has(id), `${id} should be registered`);
        }
    });

    test('package.json and constants.ts agree on the command list', () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        const contributed: string[] = (
            ext?.packageJSON?.contributes?.commands ?? []
        ).map((c: { command: string }) => c.command);

        assert.deepStrictEqual(
            [...contributed].sort(),
            [...Object.values(Cmd)].sort(),
            'contributes.commands must match the Cmd constants exactly',
        );
    });

    test('the inline action on a file row is Insert, not Edit', () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        const menus = ext?.packageJSON?.contributes?.menus?.['view/item/context'] ?? [];
        const fileInline = menus.filter(
            (m: { when: string; group?: string }) =>
                m.when.includes('viewItem == promptFile') && m.group?.startsWith('inline'),
        );

        assert.deepStrictEqual(
            fileInline.map((m: { command: string }) => m.command),
            [Cmd.insertFromTree],
            'a file row should expose exactly one inline action, and it should insert',
        );

        const insertCommand = (ext?.packageJSON?.contributes?.commands ?? []).find(
            (c: { command: string }) => c.command === Cmd.insertFromTree,
        );
        assert.strictEqual(insertCommand?.icon, '$(insert)');
    });

    test('insert and edit are both still reachable from the file right-click menu', () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        const menus = ext?.packageJSON?.contributes?.menus?.['view/item/context'] ?? [];
        const commands = menus
            .filter((m: { when: string; group?: string }) =>
                m.when.includes('viewItem == promptFile') && !m.group?.startsWith('inline'))
            .map((m: { command: string }) => m.command);

        assert.ok(commands.includes(Cmd.insertFromTree), 'Insert should remain in the context menu');
        assert.ok(commands.includes(Cmd.openSnippet), 'Edit should also be listed by name');
    });

    test('the view id in package.json matches the one the provider registers under', () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        const views = ext?.packageJSON?.contributes?.views?.promptManager ?? [];
        assert.strictEqual(views[0]?.id, VIEW_ID);
    });

    test('refresh runs without throwing', async () => {
        await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
        await vscode.commands.executeCommand(Cmd.refresh);
    });
});

suite('tree over a real directory', () => {
    let tempDir: vscode.Uri;
    let repo: SnippetRepository;
    let provider: PromptTreeProvider;
    let previousPath: string | undefined;

    setup(async () => {
        const unique = `prompt-manager-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        tempDir = vscode.Uri.file(path.join(os.tmpdir(), unique));
        await vscode.workspace.fs.createDirectory(tempDir);

        const config = vscode.workspace.getConfiguration('promptManager');
        previousPath = config.get<string>('global.path');
        await config.update('global.path', tempDir.fsPath, vscode.ConfigurationTarget.Global);

        repo = new SnippetRepository({
            globalStorageUri: tempDir,
        } as unknown as vscode.ExtensionContext);
        provider = new PromptTreeProvider(repo);
    });

    teardown(async () => {
        provider.dispose();
        await vscode.workspace
            .getConfiguration('promptManager')
            .update('global.path', previousPath, vscode.ConfigurationTarget.Global);
        try {
            await vscode.workspace.fs.delete(tempDir, { recursive: true, useTrash: false });
        } catch {
            // Cleanup is best effort.
        }
    });

    test('the global root renders with the expected label and context value', async () => {
        const roots = await provider.getChildren();
        const global = roots.find((node) => node.type === 'root' && node.root.scope === 'global');

        assert.ok(global, 'the Global Prompts root should be present');
        assert.strictEqual(global.label, 'Global Prompts');
        assert.strictEqual(global.contextValue, ContextValue.rootGlobal);
    });

    test('a root whose folder is missing is shown rather than hidden', async () => {
        await vscode.workspace.fs.delete(tempDir, { recursive: true, useTrash: false });

        const roots = await provider.getChildren();
        const global = roots.find((node) => node.type === 'root' && node.root.scope === 'global');
        assert.ok(global);
        assert.strictEqual(global.description, 'not created yet');

        await vscode.workspace.fs.createDirectory(tempDir);
    });

    test('nested snippets render as folders and files with the right context values', async () => {
        await repo.createSnippet(tempDir, 'top.md', '# Top\n');
        await repo.createSnippet(
            vscode.Uri.joinPath(tempDir, 'refactor'),
            'rename.md',
            '# Rename\n',
        );

        const roots = await provider.getChildren();
        const global = roots.find((node) => node.type === 'root' && node.root.scope === 'global');
        assert.ok(global);

        const children = await provider.getChildren(global);
        assert.deepStrictEqual(
            children.map((c) => [c.type, c.label]),
            [
                ['folder', 'refactor'],
                ['file', 'top'],
            ],
            'folders sort before files, and the file label is prettified',
        );

        const folder = children[0]!;
        const file = children[1]!;
        assert.strictEqual(folder.contextValue, ContextValue.folder);
        assert.strictEqual(file.contextValue, ContextValue.file);
        // The context values must match the `when` clauses in package.json.
        assert.strictEqual(file.command?.command, Cmd.openSnippet);

        const inFolder = await provider.getChildren(folder);
        assert.deepStrictEqual(
            inFolder.map((c) => [c.type, c.label]),
            [['file', 'rename']],
        );
    });

    test('clicking a file row opens it, and passes a Uri the handler can resolve', async () => {
        const created = await repo.createSnippet(tempDir, 'clickable.md', 'body');

        const roots = await provider.getChildren();
        const file = (await provider.getChildren(roots[0])).find((c) => c.type === 'file');
        assert.ok(file);

        assert.strictEqual(file.command?.command, Cmd.openSnippet);
        const [arg] = file.command?.arguments ?? [];
        assert.ok(arg instanceof vscode.Uri, 'the click argument should be a Uri');
        assert.strictEqual(arg.fsPath, created.fsPath);
    });

    test('a folder row has no command, so clicking it only expands', async () => {
        await repo.createSnippet(vscode.Uri.joinPath(tempDir, 'group'), 'x.md', 'body');

        const roots = await provider.getChildren();
        const folder = (await provider.getChildren(roots[0])).find((c) => c.type === 'folder');
        assert.ok(folder);
        assert.strictEqual(folder.command, undefined);
    });

    test('a file row shows its name once, with no duplicated description', async () => {
        // Regression: the row used to render as
        //   "ROCKET-PROMPT-FOR-NEW-SESSION   ROCKET-PROMPT-FOR-NEW-SESSION.md"
        await repo.createSnippet(tempDir, 'ROCKET-PROMPT-FOR-NEW-SESSION.md', 'body');

        const roots = await provider.getChildren();
        const children = await provider.getChildren(roots[0]);
        const file = children.find((c) => c.type === 'file');

        assert.ok(file);
        // The label is the prettified name; the point is that it appears exactly once.
        assert.strictEqual(file.label, 'ROCKET PROMPT FOR NEW SESSION');
        assert.ok(
            file.description === undefined || file.description === false,
            `description should be unset, got ${JSON.stringify(file.description)}`,
        );
    });

    test('a nested file does not repeat its folder or name in the description', async () => {
        await repo.createSnippet(
            vscode.Uri.joinPath(tempDir, 'writing'),
            'changelog.md',
            'body',
        );

        const roots = await provider.getChildren();
        const folder = (await provider.getChildren(roots[0])).find((c) => c.type === 'folder');
        assert.ok(folder);

        const file = (await provider.getChildren(folder))[0];
        assert.ok(file);
        assert.strictEqual(file.label, 'changelog');
        assert.ok(file.description === undefined || file.description === false);
    });

    test('building the tree sets no tooltip, which is what makes resolveTreeItem run', async () => {
        await repo.createSnippet(tempDir, 'lazy.md', '# Lazy\n\nbody\n');

        const roots = await provider.getChildren();
        const file = (await provider.getChildren(roots[0])).find((c) => c.type === 'file');
        assert.ok(file);
        // VS Code resolves only properties left undefined. A tooltip set here would mean
        // reading every snippet body just to build the tree.
        assert.strictEqual(file.tooltip, undefined);
    });

    test('hovering resolves the tooltip with the file content', async () => {
        const body = '# Code Review\n\nCheck the diff for ${VAR} usage.\n';
        await repo.createSnippet(tempDir, 'hover.md', body);

        const roots = await provider.getChildren();
        const file = (await provider.getChildren(roots[0])).find((c) => c.type === 'file');
        assert.ok(file);

        const source = new vscode.CancellationTokenSource();
        const resolved = await provider.resolveTreeItem(file, file, source.token);
        source.dispose();

        const tooltip = resolved.tooltip;
        assert.ok(tooltip instanceof vscode.MarkdownString, 'the tooltip should be Markdown');
        assert.ok(tooltip.value.includes('# Code Review'), tooltip.value);
        assert.ok(tooltip.value.includes('${VAR}'), 'the body should appear verbatim');
        // Metadata is kept at the bottom.
        assert.ok(tooltip.value.includes(file.entry.uri.fsPath));
        assert.ok(!tooltip.value.includes(TRUNCATION_NOTICE));
    });

    test('a long snippet is truncated rather than filling the screen', async () => {
        const body = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
        await repo.createSnippet(tempDir, 'long.md', body);

        const roots = await provider.getChildren();
        const file = (await provider.getChildren(roots[0])).find((c) => c.type === 'file');
        assert.ok(file);

        const source = new vscode.CancellationTokenSource();
        const resolved = await provider.resolveTreeItem(file, file, source.token);
        source.dispose();

        const value = (resolved.tooltip as vscode.MarkdownString).value;
        assert.ok(value.includes(TRUNCATION_NOTICE), value.slice(0, 200));
        assert.ok(value.includes('line 1\n'));
        assert.ok(!value.includes(`line ${TOOLTIP_MAX_LINES + 1}`), 'should stop at the line limit');
    });

    test('a deleted file degrades to a note instead of throwing at the user', async () => {
        const created = await repo.createSnippet(tempDir, 'vanishing.md', 'body');

        const roots = await provider.getChildren();
        const file = (await provider.getChildren(roots[0])).find((c) => c.type === 'file');
        assert.ok(file);

        await vscode.workspace.fs.delete(created, { recursive: false, useTrash: false });

        const source = new vscode.CancellationTokenSource();
        const resolved = await provider.resolveTreeItem(file, file, source.token);
        source.dispose();

        const value = (resolved.tooltip as vscode.MarkdownString).value;
        assert.ok(value.includes('no longer exists'), value);
    });

    test('resolving a folder is a no-op', async () => {
        await repo.createSnippet(vscode.Uri.joinPath(tempDir, 'dir'), 'x.md', 'body');

        const roots = await provider.getChildren();
        const folder = (await provider.getChildren(roots[0])).find((c) => c.type === 'folder');
        assert.ok(folder);

        const source = new vscode.CancellationTokenSource();
        const resolved = await provider.resolveTreeItem(folder, folder, source.token);
        source.dispose();
        assert.strictEqual(resolved, folder);
    });

    test('nodes carry stable ids, without which the tree collapses on every refresh', async () => {
        await repo.createSnippet(tempDir, 'stable.md', 'x');

        const first = await provider.getChildren((await provider.getChildren())[0]);
        const second = await provider.getChildren((await provider.getChildren())[0]);
        assert.deepStrictEqual(
            first.map((n) => n.id),
            second.map((n) => n.id),
        );
        assert.ok(first[0]?.id?.startsWith('file:global:'));
    });

    test('getParent walks back up, which is what reveal needs', async () => {
        const created = await repo.createSnippet(
            vscode.Uri.joinPath(tempDir, 'group'),
            'child.md',
            'x',
        );

        const node = await provider.findNodeForUri(created);
        assert.ok(node, 'the freshly created file should be locatable in the tree');

        const parent = provider.getParent(node);
        assert.strictEqual(parent?.type, 'folder');
        assert.strictEqual(parent?.label, 'group');

        const grandparent = parent ? provider.getParent(parent) : undefined;
        assert.strictEqual(grandparent?.type, 'root');
        assert.strictEqual(provider.getParent(grandparent!), undefined);
    });
});

suite('insert path', () => {
    const clipboardOnly: InsertConfig = {
        strategy: [],
        focusCommand: '',
        treatAsSnippet: false,
        notification: 'none',
    };

    test('the clipboard is written even when no strategy is configured', async () => {
        const body = 'Review this diff.\n\nFocus on ${VAR} and $1 literals.\n';
        const outcome = await insertSnippetText(body, clipboardOnly);

        assert.strictEqual(outcome.kind, 'clipboardOnly');
        // Byte-for-byte, including the trailing newline and the literal $ sequences.
        assert.strictEqual(await vscode.env.clipboard.readText(), body);
    });

    test('an unavailable command is skipped and the clipboard still holds the text', async () => {
        const body = 'fallback body';
        const outcome = await insertSnippetText(body, {
            ...clipboardOnly,
            strategy: ['definitely.not.a.real.command'],
        });

        assert.strictEqual(outcome.kind, 'clipboardOnly');
        assert.strictEqual(await vscode.env.clipboard.readText(), body);
    });

    test('the paste action is skipped when no text editor is focused', async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        const body = 'no editor focused';
        const outcome = await insertSnippetText(body, {
            ...clipboardOnly,
            strategy: ['editor.action.clipboardPasteAction'],
        });

        assert.strictEqual(outcome.kind, 'clipboardOnly');
        assert.strictEqual(await vscode.env.clipboard.readText(), body);
    });

    test('editor.insertText inserts at the cursor of the active editor', async () => {
        const doc = await vscode.workspace.openTextDocument({
            content: '',
            language: 'plaintext',
        });
        await vscode.window.showTextDocument(doc);

        const body = 'inserted literally with ${NOT_A_TABSTOP}';
        const outcome = await insertSnippetText(body, {
            ...clipboardOnly,
            strategy: ['editor.insertText'],
        });

        assert.strictEqual(outcome.kind, 'editor');
        // treatAsSnippet is off, so ${...} must survive verbatim rather than becoming a tabstop.
        assert.strictEqual(doc.getText(), body);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });
});
