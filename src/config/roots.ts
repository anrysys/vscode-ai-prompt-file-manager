import * as os from 'node:os';
import * as vscode from 'vscode';
import type { SnippetRoot } from '../model/snippet';
import { log } from '../log';
import { isKeyUnder, resolveToUri, uriKey, type ExpandContext } from '../fs/paths';
import {
    getGlobalPath,
    getWorkspacePath,
    isGlobalEnabled,
    isWorkspaceEnabled,
} from './configuration';

function expandContext(workspaceFolder?: vscode.WorkspaceFolder): ExpandContext {
    return workspaceFolder
        ? { homeDir: os.homedir(), workspaceFolder: workspaceFolder.uri.fsPath }
        : { homeDir: os.homedir() };
}

/**
 * Global snippets live wherever the user points `promptManager.global.path`. When that is
 * empty we fall back to the extension's own global storage rather than a hardcoded
 * `~/.vscode-prompts`, so the default resolves correctly on remote and WSL hosts too.
 */
export function resolveGlobalRoot(
    context: vscode.ExtensionContext,
): SnippetRoot | undefined {
    if (!isGlobalEnabled()) {
        return undefined;
    }
    const configured = getGlobalPath();
    const uri =
        resolveToUri(configured, undefined, expandContext()) ??
        vscode.Uri.joinPath(context.globalStorageUri, 'prompts');

    return {
        id: 'global',
        scope: 'global',
        label: 'Global Prompts',
        badge: 'Global',
        uri,
    };
}

export function resolveWorkspaceRoots(): SnippetRoot[] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const multiRoot = folders.length > 1;
    const roots: SnippetRoot[] = [];

    for (const folder of folders) {
        if (!isWorkspaceEnabled(folder.uri)) {
            continue;
        }
        const configured = getWorkspacePath(folder.uri);
        const uri = resolveToUri(configured, folder.uri, expandContext(folder));
        if (!uri) {
            continue;
        }
        roots.push({
            id: `workspace:${folder.index}`,
            scope: 'workspace',
            label: multiRoot ? `Workspace Prompts — ${folder.name}` : 'Workspace Prompts',
            badge: multiRoot ? folder.name : 'Workspace',
            uri,
            workspaceFolder: folder,
        });
    }
    return roots;
}

/**
 * All configured roots, global first so the tree keeps a stable top row.
 * Roots resolving to the same directory are collapsed to one.
 */
export function resolveRoots(context: vscode.ExtensionContext): SnippetRoot[] {
    const global = resolveGlobalRoot(context);
    const candidates = [...(global ? [global] : []), ...resolveWorkspaceRoots()];

    const seen = new Map<string, SnippetRoot>();
    for (const root of candidates) {
        const key = uriKey(root.uri);
        const existing = seen.get(key);
        if (existing) {
            log.info(
                `Skipping duplicate prompt root "${root.label}" — same directory as "${existing.label}" (${root.uri.fsPath})`,
            );
            continue;
        }
        seen.set(key, root);
    }
    return [...seen.values()];
}

export function findRootFor(
    uri: vscode.Uri,
    roots: readonly SnippetRoot[],
): SnippetRoot | undefined {
    const target = uriKey(uri);
    let best: SnippetRoot | undefined;
    for (const root of roots) {
        const key = uriKey(root.uri);
        if (isKeyUnder(target, key)) {
            // Prefer the most specific root when one is nested inside another.
            if (!best || key.length > uriKey(best.uri).length) {
                best = root;
            }
        }
    }
    return best;
}
