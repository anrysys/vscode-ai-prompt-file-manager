import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function createLogger(): vscode.LogOutputChannel {
    channel = vscode.window.createOutputChannel('AI Prompt File Manager', { log: true });
    return channel;
}

export const log = {
    trace(message: string, ...args: unknown[]): void {
        channel?.trace(message, ...args);
    },
    debug(message: string, ...args: unknown[]): void {
        channel?.debug(message, ...args);
    },
    info(message: string, ...args: unknown[]): void {
        channel?.info(message, ...args);
    },
    warn(message: string, ...args: unknown[]): void {
        channel?.warn(message, ...args);
    },
    error(error: unknown, ...args: unknown[]): void {
        channel?.error(error instanceof Error ? error : String(error), ...args);
    },
    show(): void {
        channel?.show(true);
    },
};
