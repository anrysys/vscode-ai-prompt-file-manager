import type * as vscode from 'vscode';

export type SnippetScope = 'global' | 'workspace';

/** A configured directory that holds prompt snippets. */
export interface SnippetRoot {
    readonly id: string;
    readonly scope: SnippetScope;
    /** Tree node label, e.g. 'Global Prompts' or 'Workspace Prompts — myapp'. */
    readonly label: string;
    /** Short scope marker used in the Quick Pick description. */
    readonly badge: string;
    readonly uri: vscode.Uri;
    readonly workspaceFolder?: vscode.WorkspaceFolder;
}

interface SnippetEntryBase {
    readonly uri: vscode.Uri;
    /** Base name including extension. */
    readonly name: string;
    /** Human-facing title derived from the file name. */
    readonly label: string;
    readonly root: SnippetRoot;
    /** POSIX path relative to `root.uri`, e.g. 'refactor/rename.md'. */
    readonly relativePath: string;
}

export interface SnippetFile extends SnippetEntryBase {
    readonly kind: 'file';
    readonly size: number;
    readonly mtime: number;
}

export interface SnippetFolder extends SnippetEntryBase {
    readonly kind: 'folder';
}

/**
 * Note there is deliberately no `content` field anywhere in this model: the file
 * system is the single source of truth, so there is nowhere for a body to go stale.
 */
export type SnippetEntry = SnippetFile | SnippetFolder;

export function isFile(entry: SnippetEntry): entry is SnippetFile {
    return entry.kind === 'file';
}

export function isFolder(entry: SnippetEntry): entry is SnippetFolder {
    return entry.kind === 'folder';
}
