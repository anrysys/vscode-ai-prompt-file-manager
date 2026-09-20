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
import { guard, notifyError } from '../ui/notify';
import type { PromptNode } from '../tree/nodes';
import type { CommandDeps } from './deps';
import { resolveSelection, type ResourceNode } from './selection';
import { resolveTarget, revealUri } from './targets';

export function registerCrudCommands(deps: CommandDeps): vscode.Disposable[] {
    const { repo, provider, treeView, usage } = deps;

    const revealAfterCreate = (uri: vscode.Uri, open: boolean): Promise<void> =>
        revealUri(provider, treeView, uri, { open });

    const createSnippet = guard('Could not create snippet', async (node?: PromptNode) => {
        const target = await resolveTarget(repo, node);
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
                const target = await resolveTarget(repo, node);
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
            guard('Could not rename', async (node?: PromptNode, selection?: PromptNode[]) => {
                const items = resolveSelection(node, selection, treeView);
                if (items.length === 0) {
                    return;
                }
                if (items.length > 1) {
                    // Renaming one arbitrary row out of five would be worse than refusing.
                    void vscode.window.showWarningMessage('Rename one item at a time.');
                    return;
                }
                const item = items[0]!;
                const current = item.entry.name;
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
                const renamed = await repo.rename(item.entry.uri, newName.trim());
                // Carried over by hand: usage is keyed by path, so without this a rename would
                // silently reset the history of the snippet -- or of a whole folder of them.
                await usage.migrate(item.entry.uri, renamed);
                await revealAfterCreate(renamed, false);
            }),
        ),

        vscode.commands.registerCommand(
            Cmd.deleteSnippet,
            guard('Could not delete', async (node?: PromptNode, selection?: PromptNode[]) => {
                const items = resolveSelection(node, selection, treeView);
                if (items.length === 0) {
                    return;
                }

                // modal: true is what makes this block; the detail lists full paths so the
                // wrong scope's copy cannot be deleted by mistake.
                const answer = await vscode.window.showWarningMessage(
                    items.length === 1
                        ? `Delete "${items[0]!.entry.name}"?`
                        : `Delete ${items.length} items?`,
                    { modal: true, detail: describeDeletion(items) },
                    'Delete',
                );
                if (answer !== 'Delete') {
                    return;
                }

                const failures: unknown[] = [];
                for (const item of items) {
                    try {
                        await repo.delete(item.entry.uri, item.type === 'folder');
                    } catch (err) {
                        // Per item, so one locked file does not strand the rest.
                        failures.push(err);
                    }
                }
                // Exactly one refresh for the whole batch, no matter how it went.
                provider.refresh();
                if (failures[0] !== undefined) {
                    notifyError(
                        failures[0],
                        failures.length === 1
                            ? 'Could not delete'
                            : `Could not delete ${failures.length} items`,
                    );
                }
            }),
        ),
    ];
}

/** Full paths, so the wrong scope's copy cannot be deleted by mistake. */
function describeDeletion(items: readonly ResourceNode[]): string {
    const SHOWN = 10;
    const listed = items.slice(0, SHOWN).map((item) => item.entry.uri.fsPath);
    const remainder = items.length - listed.length;
    const paths = remainder > 0 ? [...listed, `…and ${remainder} more`] : listed;

    const anyFolder = items.some((item) => item.type === 'folder');
    const tail =
        items.length === 1
            ? anyFolder
                ? 'The folder and everything inside it will be moved to the trash.'
                : 'The file will be moved to the trash.'
            : anyFolder
              ? 'These will be moved to the trash, folders with everything inside them.'
              : 'These will be moved to the trash.';

    return `${paths.join('\n')}\n\n${tail}`;
}
