import * as vscode from 'vscode';
import { EXT_NS } from '../constants';

export type NotificationStyle = 'statusBar' | 'toast' | 'none';

export interface InsertConfig {
    readonly strategy: readonly string[];
    readonly focusCommand: string;
    readonly treatAsSnippet: boolean;
    readonly notification: NotificationStyle;
}

export interface ObsidianConfig {
    readonly uriTemplate: string;
    readonly vaultName: string;
}

function section(resource?: vscode.Uri): vscode.WorkspaceConfiguration {
    return resource
        ? vscode.workspace.getConfiguration(EXT_NS, resource)
        : vscode.workspace.getConfiguration(EXT_NS);
}

/** Normalised to lowercase with a leading dot, so comparisons elsewhere stay trivial. */
export function getFileExtensions(): string[] {
    const raw = section().get<string[]>('fileExtensions', ['.md', '.txt']);
    const normalized = raw
        .map((ext) => ext.trim().toLowerCase())
        .filter((ext) => ext.length > 0)
        .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
    return normalized.length > 0 ? normalized : ['.md', '.txt'];
}

export function getNewSnippetExtension(): string {
    const raw = section().get<string>('newSnippet.extension', '.md').trim().toLowerCase();
    if (raw.length === 0) {
        return '.md';
    }
    return raw.startsWith('.') ? raw : `.${raw}`;
}

export function getExcludeGlobs(): string[] {
    return section()
        .get<string[]>('excludeGlobs', [])
        .map((g) => g.trim())
        .filter((g) => g.length > 0);
}

export function getMaxDepth(): number {
    const value = section().get<number>('maxDepth', 8);
    return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), 32) : 8;
}

export function getMaxFileSizeBytes(): number {
    const kb = section().get<number>('maxFileSizeKb', 512);
    const safe = Number.isFinite(kb) && kb > 0 ? kb : 512;
    return Math.trunc(safe) * 1024;
}

export function getQuickPickShowPreview(): boolean {
    return section().get<boolean>('quickPick.showPreview', true);
}

export function isGlobalEnabled(): boolean {
    return section().get<boolean>('global.enabled', true);
}

export function getGlobalPath(): string {
    return section().get<string>('global.path', '').trim();
}

export function isWorkspaceEnabled(resource: vscode.Uri): boolean {
    return section(resource).get<boolean>('workspace.enabled', true);
}

/** Read per-folder so a multi-root workspace can point each folder somewhere different. */
export function getWorkspacePath(resource: vscode.Uri): string {
    return section(resource).get<string>('workspace.path', '.vscode/prompts').trim();
}

export function getInsertConfig(): InsertConfig {
    const cfg = section();
    const strategy = cfg
        .get<string[]>('insert.strategy', [])
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    const notification = cfg.get<NotificationStyle>('insert.notification', 'statusBar');
    return {
        strategy,
        focusCommand: cfg.get<string>('insert.focusCommand', '').trim(),
        treatAsSnippet: cfg.get<boolean>('insert.treatAsSnippet', false),
        notification:
            notification === 'toast' || notification === 'none' ? notification : 'statusBar',
    };
}

export function getObsidianConfig(): ObsidianConfig {
    const cfg = section();
    const template = cfg
        .get<string>('obsidian.uriTemplate', 'obsidian://open?path={absolutePath}')
        .trim();
    return {
        uriTemplate: template.length > 0 ? template : 'obsidian://open?path={absolutePath}',
        vaultName: cfg.get<string>('obsidian.vaultName', '').trim(),
    };
}

export async function updateInsertStrategy(strategy: string[]): Promise<void> {
    await section().update(
        'insert.strategy',
        strategy,
        vscode.ConfigurationTarget.Global,
    );
}

/** Settings that change which directories are scanned, and so require a rebuild. */
const ROOT_AFFECTING_KEYS = [
    'global.enabled',
    'global.path',
    'workspace.enabled',
    'workspace.path',
    'fileExtensions',
    'excludeGlobs',
    'maxDepth',
];

export function affectsRoots(e: vscode.ConfigurationChangeEvent): boolean {
    return ROOT_AFFECTING_KEYS.some((key) => e.affectsConfiguration(`${EXT_NS}.${key}`));
}
