import type * as vscode from 'vscode';
import { registerInsertCommands } from './insertCommands';
import { registerCrudCommands } from './crudCommands';
import { registerMiscCommands } from './miscCommands';
import { registerResourceCommands } from './resourceCommands';
import type { CommandDeps } from './deps';

export type { CommandDeps } from './deps';

export function registerAllCommands(deps: CommandDeps): vscode.Disposable[] {
    return [
        ...registerInsertCommands(deps),
        ...registerCrudCommands(deps),
        ...registerMiscCommands(deps),
        ...registerResourceCommands(deps),
    ];
}
