import * as vscode from 'vscode';

let lastActiveTextEditor: vscode.TextEditor | undefined;

export function activateEditorTracker(context: vscode.ExtensionContext) {
    lastActiveTextEditor = vscode.window.activeTextEditor;
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.uri.scheme !== 'output') {
                lastActiveTextEditor = editor;
            }
        })
    );
}

export function getLastActiveTextEditor(): vscode.TextEditor | undefined {
    const current = vscode.window.activeTextEditor;
    if (current && current.document.uri.scheme !== 'output') {
        return current;
    }
    return lastActiveTextEditor;
}
