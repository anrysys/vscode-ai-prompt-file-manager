import * as vscode from 'vscode';
import { WATCH_DEBOUNCE_MS } from '../constants';
import { log } from '../log';
import type { SnippetRepository } from '../fs/repository';

/**
 * Keeps one recursive file watcher per prompt root.
 *
 * The `'**' + '/*'` pattern is what makes VS Code register a *recursive* watcher on an
 * absolute base Uri; a bare `'*'` would only watch the top level. This is the supported
 * way to watch folders outside the workspace, which the global root normally is.
 */
export class WatcherManager implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private timer: NodeJS.Timeout | undefined;

    constructor(
        private readonly repo: SnippetRepository,
        private readonly onChange: () => void,
    ) {}

    rebuild(): void {
        this.disposeWatchers();
        for (const root of this.repo.getRoots()) {
            try {
                const watcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(root.uri, '**/*'),
                );
                watcher.onDidCreate(() => this.schedule());
                watcher.onDidChange(() => this.schedule());
                watcher.onDidDelete(() => this.schedule());
                this.watchers.push(watcher);
            } catch (err) {
                log.warn(`Could not watch ${root.uri.fsPath}: ${String(err)}`);
            }
        }
        log.debug(`Watching ${this.watchers.length} prompt root(s).`);
    }

    /**
     * Trailing debounce. An atomic save fires create+change+delete for a temp file, which
     * without this would make the tree flicker several times per keystroke-save.
     */
    private schedule(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.onChange();
        }, WATCH_DEBOUNCE_MS);
    }

    private disposeWatchers(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
    }

    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.disposeWatchers();
    }
}
