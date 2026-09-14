import * as path from 'node:path';
import * as vscode from 'vscode';
import { PREVIEW_DEBOUNCE_MS } from '../constants';
import { getQuickPickShowPreview } from '../config/configuration';
import type { SnippetRepository } from '../fs/repository';
import type { SnippetFile, SnippetRoot } from '../model/snippet';
import { orderRootsForPicker, prepareGroup } from './snippetOrdering';

interface SnippetPickItem extends vscode.QuickPickItem {
    readonly file: SnippetFile;
}

type PickEntry = SnippetPickItem | vscode.QuickPickItem;

function isSnippetItem(item: PickEntry): item is SnippetPickItem {
    return 'file' in item;
}

function iconFor(file: SnippetFile): vscode.ThemeIcon {
    return new vscode.ThemeIcon(
        path.extname(file.name).toLowerCase() === '.md' ? 'markdown' : 'note',
    );
}

function badgeFor(root: SnippetRoot): string {
    // QuickPickItem.description renders codicons inline, so the badge needs no icon assets.
    const icon = root.scope === 'global' ? '$(globe)' : '$(root-folder)';
    return `${icon} ${root.badge}`;
}

function toItem(file: SnippetFile): SnippetPickItem {
    const dir = path.posix.dirname(file.relativePath);
    const item: SnippetPickItem = {
        file,
        label: file.label,
        description: badgeFor(file.root),
        iconPath: iconFor(file),
    };
    return dir === '.' ? item : { ...item, detail: dir };
}

function firstLines(text: string, limit = 120): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return collapsed.length > limit ? `${collapsed.slice(0, limit)}...` : collapsed;
}

/**
 * Lists every snippet across all roots and returns the chosen one.
 *
 * Content is never read here beyond the optional preview, and the preview string is
 * discarded immediately -- the body is read fresh from disk only after a pick.
 */
export async function pickSnippet(
    repo: SnippetRepository,
): Promise<SnippetFile | undefined> {
    const quickPick = vscode.window.createQuickPick<PickEntry>();
    quickPick.placeholder = 'Search prompt snippets...';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.busy = true;
    quickPick.show();

    const cancellation = new vscode.CancellationTokenSource();
    let previewTimer: NodeJS.Timeout | undefined;
    // Guards against a slow read for one item overwriting the UI for a later selection.
    let previewGeneration = 0;

    try {
        const items = await buildItems(repo, cancellation.token);
        quickPick.items = items;
        quickPick.busy = false;

        if (!items.some(isSnippetItem)) {
            quickPick.placeholder = 'No snippets found. Create one from the Prompt Manager view.';
        }

        if (getQuickPickShowPreview()) {
            quickPick.onDidChangeActive((active) => {
                const current = active[0];
                if (previewTimer) {
                    clearTimeout(previewTimer);
                }
                if (!current || !isSnippetItem(current)) {
                    quickPick.title = undefined;
                    return;
                }
                const generation = ++previewGeneration;
                previewTimer = setTimeout(() => {
                    void repo
                        .readSnippet(current.file.uri)
                        .then((text) => {
                            if (generation === previewGeneration) {
                                quickPick.title = firstLines(text);
                            }
                        })
                        .catch(() => {
                            if (generation === previewGeneration) {
                                quickPick.title = undefined;
                            }
                        });
                }, PREVIEW_DEBOUNCE_MS);
            });
        }

        return await new Promise<SnippetFile | undefined>((resolve) => {
            quickPick.onDidAccept(() => {
                const selected = quickPick.selectedItems[0];
                resolve(selected && isSnippetItem(selected) ? selected.file : undefined);
                quickPick.hide();
            });
            quickPick.onDidHide(() => resolve(undefined));
        });
    } finally {
        if (previewTimer) {
            clearTimeout(previewTimer);
        }
        cancellation.cancel();
        cancellation.dispose();
        quickPick.dispose();
    }
}

/**
 * Workspace roots come first because they are the more specific scope, with a separator
 * per root. Sorting stays *within* each root so the grouping the separators describe
 * remains true.
 */
async function buildItems(
    repo: SnippetRepository,
    token: vscode.CancellationToken,
): Promise<PickEntry[]> {
    const entries: PickEntry[] = [];
    const seen = new Set<string>();

    for (const root of orderRootsForPicker(repo.getRoots())) {
        const files = await repo.listFilesRecursive(root, token);
        const group = prepareGroup(files, seen);
        if (group.length === 0) {
            continue;
        }
        entries.push({ label: root.label, kind: vscode.QuickPickItemKind.Separator });
        entries.push(...group.map(toItem));
    }
    return entries;
}
