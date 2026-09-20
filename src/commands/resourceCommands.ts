import * as vscode from 'vscode';
import { Cmd } from '../constants';
import { transfer, type TransferResult } from '../fs/transfer';
import { guard, notifyTransfer } from '../ui/notify';
import type { PromptNode } from '../tree/nodes';
import type { CommandDeps } from './deps';
import { resolveSelection, targetDirectoryFor } from './selection';
import { resolveTarget } from './targets';

/**
 * Cut / Copy / Paste / Duplicate for tree resources.
 *
 * Cut is deferred: nothing moves until a paste, which is what makes it undoable by simply
 * not pasting. Copy keeps the buffer after pasting so one selection can be dropped into
 * several folders, matching the Explorer.
 */
export function registerResourceCommands(deps: CommandDeps): vscode.Disposable[] {
    const { repo, provider, treeView, usage, clipboard } = deps;

    function remember(mode: 'copy' | 'cut') {
        return (node?: PromptNode, selection?: PromptNode[]): void => {
            const items = resolveSelection(node, selection, treeView);
            if (items.length === 0) {
                return;
            }
            clipboard.set(mode, items.map((item) => item.entry.uri));
            const count = items.length;
            const noun = count === 1 ? 'item' : 'items';
            vscode.window.setStatusBarMessage(
                mode === 'cut'
                    ? `$(clippy) ${count} ${noun} ready to move — paste into a folder`
                    : `$(clippy) ${count} ${noun} copied — paste into a folder`,
                3000,
            );
        };
    }

    return [
        vscode.commands.registerCommand(Cmd.cutResource, guard('Could not cut', remember('cut'))),
        vscode.commands.registerCommand(Cmd.copyResource, guard('Could not copy', remember('copy'))),

        vscode.commands.registerCommand(
            Cmd.pasteResource,
            guard('Could not paste', async (node?: PromptNode, selection?: PromptNode[]) => {
                const contents = clipboard.read();
                if (!contents) {
                    return;
                }
                const roots = repo.getRoots();
                const items = resolveSelection(node, selection, treeView);
                // Paste into the clicked container; with nothing to go on, fall back to the
                // same root picker that New Snippet uses.
                const targetDir =
                    targetDirectoryFor(node ?? items[0], roots) ??
                    (await resolveTarget(repo))?.dir;
                if (!targetDir) {
                    return;
                }

                const result = await transfer(repo, usage, {
                    sources: contents.uris,
                    targetDir,
                    operation: contents.mode === 'cut' ? 'move' : 'copy',
                    roots,
                });

                // A cut is spent once pasted; a copy stays, so it can be pasted again.
                if (contents.mode === 'cut' && result.succeeded.length > 0) {
                    clipboard.clear();
                }
                provider.refresh();
                notifyTransfer(result);
            }),
        ),

        vscode.commands.registerCommand(
            Cmd.duplicateResource,
            guard('Could not duplicate', async (node?: PromptNode, selection?: PromptNode[]) => {
                const items = resolveSelection(node, selection, treeView);
                if (items.length === 0) {
                    return;
                }
                // Each item duplicates beside itself, relying on the -2 suffix for the
                // new name. Grouped by parent because a selection can span folders, and
                // copying them all into the first one's parent would be a move in disguise.
                const roots = repo.getRoots();
                const byParent = new Map<string, { dir: vscode.Uri; sources: vscode.Uri[] }>();
                for (const item of items) {
                    const dir = vscode.Uri.joinPath(item.entry.uri, '..');
                    const group = byParent.get(dir.toString()) ?? { dir, sources: [] };
                    group.sources.push(item.entry.uri);
                    byParent.set(dir.toString(), group);
                }

                const merged = {
                    operation: 'copy' as const,
                    targetDir: byParent.values().next().value!.dir,
                    succeeded: [] as TransferResult['succeeded'],
                    rejected: [] as TransferResult['rejected'],
                    failed: [] as TransferResult['failed'],
                };
                for (const { dir, sources } of byParent.values()) {
                    const result = await transfer(repo, usage, {
                        sources,
                        targetDir: dir,
                        operation: 'copy',
                        roots,
                    });
                    merged.succeeded = [...merged.succeeded, ...result.succeeded];
                    merged.rejected = [...merged.rejected, ...result.rejected];
                    merged.failed = [...merged.failed, ...result.failed];
                }

                provider.refresh();
                notifyTransfer(merged);
            }),
        ),
    ];
}
