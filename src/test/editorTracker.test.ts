import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { insertSnippetText } from '../insert/inserter';
import { createEditorTracker, getMacroSourceEditor } from '../macros/editorTracker';
import { resolveMacros } from '../macros/macroResolver';
import type { InsertConfig } from '../config/configuration';

/**
 * The tracker is what keeps `{{selection}}` working once focus moves into a chat webview,
 * where `window.activeTextEditor` is undefined. Every case below drives the real window:
 * a stub would only prove that the stub matches the code.
 *
 * `createEditorTracker` rather than `activateEditorTracker`, because the tracker under
 * test has to be the instance this test file imports — the one inside the bundled
 * extension host is a different module instance with its own state.
 */

const TIMEOUT_MS = 10_000;
const VIRTUAL_SCHEME = 'prompt-manager-test';

async function waitFor(what: string, predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
        if (Date.now() > deadline) {
            assert.fail(`Timed out waiting for ${what}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

suite('macro source editor', () => {
    let tracker: vscode.Disposable | undefined;
    let panel: vscode.WebviewPanel | undefined;
    let virtualProvider: vscode.Disposable | undefined;
    let tempDir: vscode.Uri | undefined;

    setup(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        tracker = createEditorTracker();
    });

    teardown(async () => {
        panel?.dispose();
        panel = undefined;
        virtualProvider?.dispose();
        virtualProvider = undefined;
        tracker?.dispose();
        tracker = undefined;
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        if (tempDir) {
            try {
                await vscode.workspace.fs.delete(tempDir, { recursive: true, useTrash: false });
            } catch {
                // Best effort: a failed cleanup must not fail the suite.
            }
            tempDir = undefined;
        }
    });

    async function openTempFile(name: string, content: string): Promise<vscode.TextEditor> {
        const unique = `prompt-manager-tracker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        tempDir = vscode.Uri.file(path.join(os.tmpdir(), unique));
        await vscode.workspace.fs.createDirectory(tempDir);
        const file = vscode.Uri.joinPath(tempDir, name);
        await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(content));
        const doc = await vscode.workspace.openTextDocument(file);
        return await vscode.window.showTextDocument(doc, { preview: false });
    }

    test('focus in a webview falls back to the editor the user came from', async function () {
        this.timeout(TIMEOUT_MS);
        const editor = await openTempFile('target.ts', 'alpha\nbeta\ngamma\n');
        editor.selection = new vscode.Selection(1, 0, 1, 4);

        // A webview panel in the editor area is how a chat extension takes the focus, and
        // it is the exact state in which activeTextEditor goes undefined.
        panel = vscode.window.createWebviewPanel(
            VIRTUAL_SCHEME,
            'Chat stand-in',
            vscode.ViewColumn.Active,
            {},
        );
        await waitFor('activeTextEditor to go undefined', () => !vscode.window.activeTextEditor);

        assert.strictEqual(getMacroSourceEditor(), editor);
        assert.strictEqual(
            await resolveMacros('[{{selection}}][{{active_file}}]'),
            '[beta][target.ts]',
        );
    });

    test('a closed document stops being the macro source', async function () {
        this.timeout(TIMEOUT_MS);
        const doc = await vscode.workspace.openTextDocument({
            content: 'alpha\nbeta\n',
            language: 'plaintext',
        });
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        editor.selection = new vscode.Selection(0, 0, 1, 0);
        assert.strictEqual(getMacroSourceEditor(), editor);

        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await waitFor('the document to close', () => doc.isClosed);

        // The point of the guard: a remembered editor must not outlive its document, or a
        // prompt would quietly carry text the user can no longer see.
        assert.strictEqual(getMacroSourceEditor(), undefined);
        assert.strictEqual(await resolveMacros('[{{selection}}][{{active_file}}]'), '[][]');
    });

    test('a virtual document never becomes the macro source', async function () {
        this.timeout(TIMEOUT_MS);
        const editor = await openTempFile('real.ts', 'alpha\nbeta\n');
        editor.selection = new vscode.Selection(0, 0, 0, 5);

        virtualProvider = vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_SCHEME, {
            provideTextDocumentContent: () => 'generated content\n',
        });
        const virtualUri = vscode.Uri.parse(`${VIRTUAL_SCHEME}:generated.txt`);
        const virtualDoc = await vscode.workspace.openTextDocument(virtualUri);
        await vscode.window.showTextDocument(virtualDoc, { preview: false });
        await waitFor(
            'the virtual document to become active',
            () => vscode.window.activeTextEditor?.document.uri.scheme === VIRTUAL_SCHEME,
        );

        // Output channels, diff sides and other generated views are not the file the user
        // is working on, so the real editor keeps answering.
        assert.strictEqual(getMacroSourceEditor(), editor);
        assert.strictEqual(await resolveMacros('{{active_file}}'), 'real.ts');
    });
});

suite('insert follows the macro source editor', () => {
    const editorInsert: InsertConfig = {
        strategy: ['editor.insertText'],
        focusCommand: '',
        treatAsSnippet: false,
        notification: 'none',
    };

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('the snippet replaces the selection in the editor it was resolved against', async function () {
        this.timeout(TIMEOUT_MS);
        const sourceDoc = await vscode.workspace.openTextDocument({
            content: 'SELECT ME\n',
            language: 'plaintext',
        });
        const source = await vscode.window.showTextDocument(sourceDoc, { preview: false });
        source.selection = new vscode.Selection(0, 0, 0, 9);

        const otherDoc = await vscode.workspace.openTextDocument({
            content: 'do not touch\n',
            language: 'plaintext',
        });
        await vscode.window.showTextDocument(otherDoc, {
            preview: false,
            viewColumn: vscode.ViewColumn.Beside,
        });
        await waitFor(
            'the second editor to take focus',
            () => vscode.window.activeTextEditor?.document === otherDoc,
        );

        const outcome = await insertSnippetText('WRAPPED', editorInsert, {
            editor: source,
            writable: true,
        });

        assert.strictEqual(outcome.kind, 'editor');
        // Without the target the insert would have landed in whatever is focused now.
        assert.strictEqual(sourceDoc.getText(), 'WRAPPED\n');
        assert.strictEqual(otherDoc.getText(), 'do not touch\n');
    });
});

suite('the insert never eats the selection it quoted', () => {
    const base: InsertConfig = {
        strategy: [],
        focusCommand: '',
        treatAsSnippet: false,
        notification: 'none',
    };

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    async function openSelected(content: string, selection: vscode.Selection) {
        const doc = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        editor.selection = selection;
        return { doc, editor };
    }

    /**
     * The 0.1.9 report, reproduced: select a function, press the insert keybinding with an
     * editor-writing strategy configured, and the prompt lands on top of the code it just
     * quoted. Both strategies that can write into a document are covered, because the user
     * had both of them configured at once.
     */
    test('editor.insertText is skipped when the snippet quotes this selection', async function () {
        this.timeout(TIMEOUT_MS);
        const { doc, editor } = await openSelected(
            'function broken() {}\n',
            new vscode.Selection(0, 0, 0, 20),
        );

        const outcome = await insertSnippetText(
            'Find the bug in function broken() {}',
            { ...base, strategy: ['editor.insertText'] },
            { editor, writable: false },
        );

        assert.strictEqual(outcome.kind, 'guarded');
        assert.strictEqual(doc.getText(), 'function broken() {}\n');
        assert.strictEqual(
            await vscode.env.clipboard.readText(),
            'Find the bug in function broken() {}',
        );
    });

    test('the paste action is skipped when the focused editor is the quoted one', async function () {
        this.timeout(TIMEOUT_MS);
        const { doc, editor } = await openSelected(
            'function broken() {}\n',
            new vscode.Selection(0, 0, 0, 20),
        );

        const outcome = await insertSnippetText(
            'Find the bug in function broken() {}',
            { ...base, strategy: ['editor.action.clipboardPasteAction'] },
            { editor, writable: false },
        );

        assert.strictEqual(outcome.kind, 'guarded');
        assert.strictEqual(doc.getText(), 'function broken() {}\n');
    });

    test('a snippet that quotes nothing still inserts', async function () {
        this.timeout(TIMEOUT_MS);
        const { doc, editor } = await openSelected('', new vscode.Selection(0, 0, 0, 0));

        const outcome = await insertSnippetText(
            'plain body',
            { ...base, strategy: ['editor.insertText'] },
            { editor, writable: true },
        );

        assert.strictEqual(outcome.kind, 'editor');
        assert.strictEqual(doc.getText(), 'plain body');
    });
});
