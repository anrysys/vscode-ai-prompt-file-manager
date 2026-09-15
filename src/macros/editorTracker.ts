import * as vscode from 'vscode';

/**
 * Schemes a macro may read from.
 *
 * `window.activeTextEditor` also reports diff sides (`git:`), output channels, search
 * results and any other virtual provider. Those are viewers, not the file the user is
 * working on, and letting one become the remembered editor would put text the user never
 * opened into a prompt — the failure this module exists to prevent.
 */
const MACRO_SOURCE_SCHEMES: ReadonlySet<string> = new Set([
    'file',
    'untitled',
    'vscode-userdata',
]);

let lastActiveTextEditor: vscode.TextEditor | undefined;

function isUsableSource(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
    return (
        editor !== undefined &&
        !editor.document.isClosed &&
        MACRO_SOURCE_SCHEMES.has(editor.document.uri.scheme)
    );
}

/**
 * Starts tracking and hands back one disposable that both unsubscribes and forgets the
 * remembered editor. Separate from `activateEditorTracker` so a test can run a tracker
 * without an `ExtensionContext` and leave no state behind for the next suite.
 */
export function createEditorTracker(): vscode.Disposable {
    lastActiveTextEditor = isUsableSource(vscode.window.activeTextEditor)
        ? vscode.window.activeTextEditor
        : undefined;

    const subscriptions = [
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            // An undefined editor means focus went to a chat webview, the terminal or a
            // settings tab. That is precisely the case the fallback exists for, so the
            // previous editor is kept rather than cleared.
            if (isUsableSource(editor)) {
                lastActiveTextEditor = editor;
            }
        }),
        vscode.workspace.onDidCloseTextDocument((doc) => {
            // Without this the tracker would keep answering with a document the user has
            // closed: {{active_file}} would name an invisible file and {{selection}} would
            // quote text that is no longer on screen.
            if (lastActiveTextEditor?.document === doc) {
                lastActiveTextEditor = undefined;
            }
        }),
    ];

    return new vscode.Disposable(() => {
        for (const subscription of subscriptions) {
            subscription.dispose();
        }
        lastActiveTextEditor = undefined;
    });
}

export function activateEditorTracker(context: vscode.ExtensionContext): void {
    context.subscriptions.push(createEditorTracker());
}

/**
 * The editor macros read from: the active one, or the last real one if focus has left the
 * editor area. Returns undefined when neither is usable, which expands to empty text.
 */
export function getMacroSourceEditor(): vscode.TextEditor | undefined {
    const current = vscode.window.activeTextEditor;
    if (isUsableSource(current)) {
        return current;
    }
    return isUsableSource(lastActiveTextEditor) ? lastActiveTextEditor : undefined;
}
