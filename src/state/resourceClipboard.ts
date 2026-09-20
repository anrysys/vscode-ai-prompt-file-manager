import type * as vscode from 'vscode';
import { ContextKey } from '../constants';

/**
 * The cut/copy buffer for tree resources.
 *
 * Deliberately *not* `vscode.env.clipboard`. That one is text-only and already belongs to
 * `copyToClipboard`, which puts a snippet's body there for pasting into a chat. Writing
 * file paths over it would clobber the thing this extension exists to do.
 *
 * In memory and session-scoped, like the Explorer's own clipboard: a cut whose source was
 * deleted in another window between sessions is a footgun with no upside.
 */

export type ClipboardMode = 'copy' | 'cut';

export interface ClipboardContents {
    readonly mode: ClipboardMode;
    readonly uris: readonly vscode.Uri[];
}

export class ResourceClipboard {
    private contents: ClipboardContents | undefined;

    /** `setContext` is injected so this stays testable without a live command registry. */
    constructor(private readonly setContext: (key: string, value: boolean) => void) {}

    set(mode: ClipboardMode, uris: readonly vscode.Uri[]): void {
        this.contents = uris.length > 0 ? { mode, uris: [...uris] } : undefined;
        this.publish();
    }

    read(): ClipboardContents | undefined {
        return this.contents;
    }

    clear(): void {
        this.contents = undefined;
        this.publish();
    }

    private publish(): void {
        // Drives the `when` clause on Paste, so the entry is hidden until there is
        // something to paste.
        this.setContext(ContextKey.clipboardHasItems, this.contents !== undefined);
    }
}
