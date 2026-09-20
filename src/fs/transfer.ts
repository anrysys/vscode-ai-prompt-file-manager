import * as path from 'node:path';
import * as vscode from 'vscode';
import type { SnippetRepository } from './repository';
import type { SnippetRoot } from '../model/snippet';
import type { UsageTracker } from '../state/usageTracker';
import {
    dedupeByUri,
    planPlacements,
    pruneNested,
    type PlacementRejected,
    type TransferOperation,
} from './boundary';

/**
 * Batch move/copy of prompt resources.
 *
 * Lives in `fs/` and performs no UI work of its own: it neither refreshes the tree nor
 * shows a message. That is what makes it testable against a real temp directory, and it
 * keeps the "one gesture, one notification" rule enforceable by the caller.
 */

/**
 * What a transfer needs from the usage tracker. Narrow on purpose, mirroring `PickerUsage`,
 * so tests can record calls without standing up a Memento.
 */
export type UsageMigrator = Pick<UsageTracker, 'migrate'>;

export interface TransferRequest {
    readonly sources: readonly vscode.Uri[];
    readonly targetDir: vscode.Uri;
    readonly operation: TransferOperation;
    readonly roots: readonly SnippetRoot[];
}

export interface TransferSuccess {
    readonly from: vscode.Uri;
    readonly to: vscode.Uri;
    /** True when a name clash forced a `-2` suffix. */
    readonly renamed: boolean;
}

export interface TransferFailure {
    readonly source: vscode.Uri;
    readonly error: unknown;
}

export interface TransferResult {
    readonly operation: TransferOperation;
    readonly targetDir: vscode.Uri;
    readonly succeeded: readonly TransferSuccess[];
    readonly rejected: readonly PlacementRejected[];
    readonly failed: readonly TransferFailure[];
}

export function isTransferEmpty(result: TransferResult): boolean {
    return (
        result.succeeded.length === 0 &&
        result.rejected.length === 0 &&
        result.failed.length === 0
    );
}

export async function transfer(
    repo: SnippetRepository,
    usage: UsageMigrator,
    request: TransferRequest,
    token?: vscode.CancellationToken,
): Promise<TransferResult> {
    const { targetDir, operation, roots } = request;

    // Dedupe before pruning: overlapping roots can surface the same directory twice.
    const sources = pruneNested(dedupeByUri(request.sources, (u) => u), (u) => u);
    const { accepted, rejected } = planPlacements(sources, targetDir, roots, operation);

    const succeeded: TransferSuccess[] = [];
    const failed: TransferFailure[] = [];
    const moving = operation === 'move';

    for (const placement of accepted) {
        if (token?.isCancellationRequested) {
            break;
        }
        try {
            // Also confirms the source still exists, and tells a file from a folder so the
            // collision suffix lands in the right place.
            const isDirectory = await repo.isDirectory(placement.source);

            let destination = placement.destination;
            let renamed = false;
            if (await repo.exists(destination)) {
                destination = await repo.findFreeUri(
                    placement.targetDir,
                    path.basename(placement.source.fsPath),
                    { keepExtension: !isDirectory },
                );
                renamed = true;
            }

            if (moving) {
                await repo.move(placement.source, destination, { overwrite: false });
                // Usage is keyed by absolute path, so a move that skipped this would
                // silently reset the history of the snippet, or of a whole folder of them.
                // Note this is the *actual* destination: migrating to the planned one
                // would lose the history whenever a clash forced a rename.
                await usage.migrate(placement.source, destination);
            } else {
                await repo.copy(placement.source, destination, { overwrite: false });
                // Deliberately no migrate on a copy: the original keeps its history and
                // the duplicate starts at zero, which is the honest reading of "copy".
            }

            succeeded.push({ from: placement.source, to: destination, renamed });
        } catch (error) {
            // Per item, so one permission error cannot abandon the rest of the batch.
            failed.push({ source: placement.source, error });
        }
    }

    return { operation, targetDir, succeeded, rejected, failed };
}

function verb(operation: TransferOperation, count: number): string {
    const noun = count === 1 ? 'item' : 'items';
    switch (operation) {
        case 'move':
            return `Moved ${count} ${noun}`;
        case 'copy':
            return `Copied ${count} ${noun}`;
        case 'import':
            return `Imported ${count} ${noun}`;
    }
}

/** One sentence describing the whole batch. Pure, so the wording is testable. */
export function describeTransfer(result: TransferResult): string {
    const parts: string[] = [];

    if (result.succeeded.length > 0) {
        const name = path.basename(result.targetDir.fsPath);
        parts.push(`${verb(result.operation, result.succeeded.length)} to "${name}"`);
        const renamed = result.succeeded.filter((s) => s.renamed).length;
        if (renamed > 0) {
            parts.push(
                renamed === 1
                    ? '1 was renamed to avoid a name clash'
                    : `${renamed} were renamed to avoid name clashes`,
            );
        }
    }

    // Rejections are explained individually when there is only one, because the reason is
    // the entire point of the message ("cannot be moved into itself").
    if (result.rejected.length === 1) {
        parts.push(result.rejected[0]!.message);
    } else if (result.rejected.length > 1) {
        parts.push(`${result.rejected.length} items were skipped`);
    }

    if (result.failed.length > 0) {
        parts.push(
            result.failed.length === 1 ? '1 item failed' : `${result.failed.length} items failed`,
        );
    }

    return parts.length > 0 ? parts.join(' — ') : 'Nothing to do.';
}
