import * as vscode from 'vscode';
import { Cmd } from '../constants';
import { guard } from '../ui/notify';
import { uriOf, type PromptNode } from '../tree/nodes';
import type { CommandDeps } from './deps';
import { resolveSelectionForReading } from './selection';

/**
 * Copy Path, Copy Relative Path and Open in Integrated Terminal.
 *
 * The three commands that answer "where does this actually live?". None of them change
 * anything on disk, which is why they resolve their rows with `resolveSelectionForReading`
 * rather than `resolveSelection`: a read has no reason to drop the child of a selected
 * folder, and no reason to refuse a root.
 */

/** Opening one shell per selected row is what the Explorer does; twenty of them is a slip. */
const CONFIRM_TERMINALS_ABOVE = 5;

/** Native separators, because this is the path the user is about to paste into a shell. */
export function absolutePathOf(node: PromptNode): string {
    return uriOf(node).fsPath;
}

/**
 * Relative to the node's own prompt root.
 *
 * `entry.relativePath` is already exactly that, computed once when the tree was scanned, so
 * there is no path arithmetic here to get wrong -- and it is POSIX on every platform by the
 * model's contract, which is what keeps a copied path portable between a Windows checkout
 * and the Linux box the prompt is headed for.
 *
 * A root is the thing the path is relative *to*, so the honest answer is '.'. An empty
 * string would be a blank line in the middle of a multi-row copy, indistinguishable from a
 * bug.
 */
export function relativePathOf(node: PromptNode): string {
    return node.type === 'root' ? '.' : node.entry.relativePath;
}

/** The row's own name, used to tell several terminals apart in the dropdown. */
function nameOf(node: PromptNode): string {
    return node.type === 'root' ? node.root.label : node.entry.name;
}

export function registerPathCommands(deps: CommandDeps): vscode.Disposable[] {
    const { repo, provider, treeView } = deps;

    /** Both copy commands are one command over two projections of a row. */
    function copyPaths(noun: string, pathOf: (node: PromptNode) => string) {
        return async (node?: PromptNode, selection?: PromptNode[]): Promise<void> => {
            const items = resolveSelectionForReading(node, selection, treeView);
            if (items.length === 0) {
                return;
            }
            // One row per line, no trailing newline: this goes into a shell or a chat
            // message at least as often as into an editor.
            const text = items.map(pathOf).join('\n');
            // Deliberately the *system* clipboard, unlike Cut/Copy on the same menu, which
            // keep their own buffer precisely so they cannot clobber a prompt on its way to
            // a chat panel. Here the paths are the thing that was asked for.
            await vscode.env.clipboard.writeText(text);
            vscode.window.setStatusBarMessage(
                items.length === 1
                    ? `$(clippy) Copied the ${noun} to the clipboard`
                    : `$(clippy) Copied ${items.length} ${noun}s to the clipboard`,
                3000,
            );
        };
    }

    /**
     * A shell refuses to start in a directory that is not there, and says so inside the
     * terminal, where nobody is looking. A root that was never created is an expected state
     * the tree renders on purpose, so it is created here, exactly as Open Global Prompts
     * Folder already does. A folder row that has gone missing means the tree is stale
     * instead, and the honest answer is to say so and refresh.
     */
    async function usableCwd(node: PromptNode): Promise<vscode.Uri | undefined> {
        const uri = uriOf(node);
        if (await repo.exists(uri)) {
            return uri;
        }
        if (node.type === 'root') {
            await repo.ensureDirectory(uri);
            provider.refresh();
            return uri;
        }
        void vscode.window.showWarningMessage(`"${nameOf(node)}" no longer exists.`);
        provider.refresh();
        return undefined;
    }

    return [
        vscode.commands.registerCommand(
            Cmd.copyPath,
            guard('Could not copy the path', copyPaths('path', absolutePathOf)),
        ),

        vscode.commands.registerCommand(
            Cmd.copyRelativePath,
            guard(
                'Could not copy the relative path',
                copyPaths('relative path', relativePathOf),
            ),
        ),

        vscode.commands.registerCommand(
            Cmd.openInTerminal,
            guard(
                'Could not open a terminal',
                async (node?: PromptNode, selection?: PromptNode[]) => {
                    // Files are dropped rather than redirected to their parent folder. The
                    // menu entry never appears on a file row, so a file can only arrive here
                    // inside a mixed multi-row selection, and opening a shell somewhere the
                    // user did not point at is worse than opening one fewer.
                    const folders = resolveSelectionForReading(
                        node,
                        selection,
                        treeView,
                    ).filter((item) => item.type !== 'file');
                    if (folders.length === 0) {
                        return;
                    }
                    if (folders.length > CONFIRM_TERMINALS_ABOVE) {
                        const answer = await vscode.window.showWarningMessage(
                            `Open ${folders.length} terminals?`,
                            { modal: true },
                            'Open',
                        );
                        if (answer !== 'Open') {
                            return;
                        }
                    }

                    const opened: vscode.Terminal[] = [];
                    for (const folder of folders) {
                        const cwd = await usableCwd(folder);
                        if (!cwd) {
                            continue;
                        }
                        // VS Code's own integrated terminal, never an OS console: no process
                        // is spawned here at all, the host owns the shell. `cwd` takes the
                        // Uri and not a string so that on a remote, WSL or container window
                        // the shell starts on the host the Uri resolves against, which a
                        // bare path would silently lose.
                        opened.push(
                            vscode.window.createTerminal({ name: nameOf(folder), cwd }),
                        );
                    }
                    // Only the last one is revealed. show() per terminal would flick the
                    // panel through every folder in turn, and the focus has to land
                    // somewhere definite.
                    opened.at(-1)?.show();
                },
            ),
        ),
    ];
}
