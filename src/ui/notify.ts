import * as vscode from 'vscode';
import { log } from '../log';
import { SnippetTooLargeError } from '../fs/repository';
import { formatBytes } from '../fs/paths';
import type { InsertConfig } from '../config/configuration';
import type { InsertOutcome } from '../insert/inserter';
import { describeTransfer, isTransferEmpty, type TransferResult } from '../fs/transfer';

/**
 * A command resolving without throwing is not proof that it inserted anything -- a chat
 * command with no chat provider installed resolves silently and does nothing. So the
 * wording says which command ran, and never claims the text was inserted.
 */
export function describeOutcome(outcome: InsertOutcome, label: string): string {
    const name = `"${label}"`;
    switch (outcome.kind) {
        case 'editor':
            return `Inserted ${name} at the cursor`;
        case 'command':
            return `Copied ${name} to clipboard, ran ${outcome.commandId}`;
        case 'focused':
            return `Copied ${name} to clipboard, press Ctrl+V in the chat input`;
        case 'guarded':
            // Silence here would read as "the insert did nothing", and the user would try
            // again rather than reach for Ctrl+V. The two reasons need different words: one is
            // about what the snippet says, the other about what the user did while answering it.
            return outcome.reason === 'selectionChanged'
                ? `Copied ${name} to clipboard — not inserted, your selection moved while you were filling it in`
                : `Copied ${name} to clipboard — not inserted, it quotes the selection it would have replaced`;
        case 'clipboardOnly':
            return `Copied ${name} to clipboard`;
    }
}

export function notifyInsert(
    outcome: InsertOutcome,
    label: string,
    cfg: InsertConfig,
): void {
    const message = describeOutcome(outcome, label);
    log.info(message);
    switch (cfg.notification) {
        case 'toast':
            void vscode.window.showInformationMessage(message);
            break;
        case 'statusBar':
            // Auto-dismisses and does not steal focus, unlike a toast on every insert.
            vscode.window.setStatusBarMessage(`$(clippy) ${message}`, 3000);
            break;
        case 'none':
            break;
    }
}

export function notifyError(err: unknown, context: string): void {
    log.error(err instanceof Error ? err : new Error(String(err)));

    if (err instanceof SnippetTooLargeError) {
        void vscode.window.showWarningMessage(
            `${err.uri.path.split('/').pop()} is ${formatBytes(err.size)}, over the ${formatBytes(err.limit)} limit. Raise promptManager.maxFileSizeKb to load it.`,
        );
        return;
    }
    if (err instanceof vscode.FileSystemError) {
        if (err.code === 'FileNotFound') {
            void vscode.window.showWarningMessage(`${context}: that file no longer exists.`);
            return;
        }
        if (err.code === 'NoPermissions') {
            void vscode.window.showErrorMessage(`${context}: permission denied.`);
            return;
        }
        if (err.code === 'FileExists') {
            void vscode.window.showWarningMessage(`${context}: that name is already taken.`);
            return;
        }
    }

    const message = err instanceof Error ? err.message : String(err);
    void vscode.window
        .showErrorMessage(`${context}: ${message}`, 'Show Log')
        .then((choice) => {
            if (choice === 'Show Log') {
                log.show();
            }
        });
}

/** Wraps a command handler so a rejection surfaces a real message instead of a bare failure. */
export function guard<A extends unknown[]>(
    context: string,
    fn: (...args: A) => Promise<void> | void,
): (...args: A) => Promise<void> {
    return async (...args: A) => {
        try {
            await fn(...args);
        } catch (err) {
            notifyError(err, context);
        }
    };
}

/**
 * One message for one gesture. A drop of twenty items that half-succeeds must not produce
 * twenty dialogs, so the whole batch is summarised in a single line.
 */
export function notifyTransfer(result: TransferResult): void {
    if (isTransferEmpty(result)) {
        return;
    }
    const message = describeTransfer(result);
    log.info(message);

    for (const failure of result.failed) {
        log.error(
            failure.error instanceof Error ? failure.error : new Error(String(failure.error)),
        );
    }

    if (result.failed.length > 0) {
        void vscode.window.showErrorMessage(message);
        return;
    }
    if (result.rejected.length > 0 && result.succeeded.length === 0) {
        // Nothing happened and the user asked for something: say why, but it is not an error.
        void vscode.window.showWarningMessage(message);
        return;
    }
    vscode.window.setStatusBarMessage(`$(files) ${message}`, 3000);
}
