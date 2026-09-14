import * as path from 'node:path';
import * as vscode from 'vscode';
import { Cmd } from '../constants';
import { getFileExtensions, getNewSnippetExtension } from '../config/configuration';
import {
    slugifyTitle,
    slugifyTitlePath,
    snippetFileName,
    stripSnippetExtension,
} from '../fs/paths';
import { guard } from '../ui/notify';
import type { SnippetRoot } from '../model/snippet';
import { rootOf, targetDirectoryOf, type PromptNode } from '../tree/nodes';
import type { CommandDeps } from './deps';

export function registerCrudCommands(deps: CommandDeps): vscode.Disposable[] {
    const { repo, provider, treeView } = deps;

    /** Resolves the directory a create action should target, asking when there is no node. */
    async function resolveTarget(
        node?: PromptNode,
    ): Promise<{ dir: vscode.Uri; root: SnippetRoot } | undefined> {
        if (node) {
            return { dir: targetDirectoryOf(node), root: rootOf(node) };
        }
        const roots = repo.getRoots();
        if (roots.length === 0) {
            void vscode.window.showWarningMessage(
                'No prompt folders are configured. Check the promptManager.global.path setting.',
            );
            return undefined;
        }
        if (roots.length === 1) {
            const only = roots[0]!;
            return { dir: only.uri, root: only };
        }
        const picked = await vscode.window.showQuickPick(
            roots.map((root) => ({ label: root.label, description: root.uri.fsPath, root })),
            { placeHolder: 'Where should this snippet live?' },
        );
        return picked ? { dir: picked.root.uri, root: picked.root } : undefined;
    }

    async function revealAfterCreate(uri: vscode.Uri, open: boolean): Promise<void> {
        provider.refresh();
        if (open) {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
        }
        const node = await provider.findNodeForUri(uri);
        if (node) {
            await treeView.reveal(node, { select: true, focus: false });
        }
    }

    const createSnippet = guard('Could not create snippet', async (node?: PromptNode) => {
        const target = await resolveTarget(node);
        if (!target) {
            return;
        }

        const title = await vscode.window.showInputBox({
            prompt: 'Snippet title',
            placeHolder: 'Code Review  (use / to nest, e.g. review/security)',
            validateInput: (value) => {
                if (value.trim().length === 0) {
                    return 'Enter a title.';
                }
                return slugifyTitlePath(value) ? undefined : 'That title has no usable characters.';
            },
        });
        if (title === undefined) {
            return;
        }

        const segments = slugifyTitlePath(title);
        if (!segments) {
            return;
        }
        // A title may nest: "review/security" creates the intermediate folder.
        const fileStem = segments.pop()!;
        const dir =
            segments.length > 0 ? vscode.Uri.joinPath(target.dir, ...segments) : target.dir;

        const ext = getNewSnippetExtension();
        const extensions = getFileExtensions();
        const fileName = snippetFileName(fileStem, extensions, ext);
        // Strip the extension so a title typed as "notes.md" seeds "# notes", but keep the
        // title's own punctuation: "Follow-up questions" must not become "Follow up questions".
        const heading = stripSnippetExtension(
            title.split(/[\\/]+/).pop()?.trim() ?? fileStem,
            extensions,
        );
        const initial = fileName.toLowerCase().endsWith('.md') ? `# ${heading}\n\n` : '';

        const created = await repo.createSnippet(dir, fileName, initial);
        await revealAfterCreate(created, true);
    });

    return [
        vscode.commands.registerCommand(Cmd.newSnippet, createSnippet),
        vscode.commands.registerCommand(Cmd.newSnippetHere, createSnippet),

        vscode.commands.registerCommand(
            Cmd.newFolder,
            guard('Could not create folder', async (node?: PromptNode) => {
                const target = await resolveTarget(node);
                if (!target) {
                    return;
                }
                const name = await vscode.window.showInputBox({
                    prompt: 'Folder name',
                    validateInput: (value) =>
                        slugifyTitle(value) ? undefined : 'That name has no usable characters.',
                });
                if (name === undefined) {
                    return;
                }
                const slug = slugifyTitle(name);
                if (!slug) {
                    return;
                }
                const created = await repo.createFolder(target.dir, slug);
                await revealAfterCreate(created, false);
            }),
        ),

        vscode.commands.registerCommand(
            Cmd.renameSnippet,
            guard('Could not rename', async (node?: PromptNode) => {
                if (!node || node.type === 'root') {
                    return;
                }
                const current = node.entry.name;
                const ext = path.extname(current);
                const options: vscode.InputBoxOptions = {
                    prompt: 'New name',
                    value: current,
                    validateInput: (value) =>
                        value.trim().length === 0 || /[\\/]/.test(value)
                            ? 'Enter a name without path separators.'
                            : undefined,
                };
                if (ext.length > 0) {
                    // Preselect the stem so the extension is not accidentally typed over.
                    options.valueSelection = [0, current.length - ext.length];
                }
                const newName = await vscode.window.showInputBox(options);
                if (newName === undefined || newName.trim() === current) {
                    return;
                }
                // workspace.fs.rename retargets any open editor on the file automatically.
                const renamed = await repo.rename(node.entry.uri, newName.trim());
                await revealAfterCreate(renamed, false);
            }),
        ),

        vscode.commands.registerCommand(
            Cmd.deleteSnippet,
            guard('Could not delete', async (node?: PromptNode) => {
                if (!node || node.type === 'root') {
                    return;
                }
                const isFolder = node.type === 'folder';
                const detail = isFolder
                    ? `${node.entry.uri.fsPath}\n\nThe folder and everything inside it will be moved to the trash.`
                    : `${node.entry.uri.fsPath}\n\nThe file will be moved to the trash.`;

                // modal: true is what makes this block; detail shows the full path so the
                // wrong scope's copy cannot be deleted by mistake.
                const answer = await vscode.window.showWarningMessage(
                    `Delete "${node.entry.name}"?`,
                    { modal: true, detail },
                    'Delete',
                );
                if (answer !== 'Delete') {
                    return;
                }
                await repo.delete(node.entry.uri, isFolder);
                provider.refresh();
            }),
        ),
    ];
}
