import * as vscode from 'vscode';
import type { InteractiveValues, InteractiveVariable } from './macroSyntax';

/**
 * Asks the user for every interactive variable a snippet uses, in order.
 *
 * Injected into `resolveMacros` rather than called from it directly, so the cancellation and
 * ordering rules can be tested without driving a real quick input.
 */
export type InteractiveAsker = (
    variables: readonly InteractiveVariable[],
    label: string,
) => Promise<InteractiveValues | undefined>;

/**
 * A step counter, because three dialogs in a row with no sense of progress read as a freeze.
 *
 * Shown only when there is more than one: "(1/1)" on a single box is noise, and the count is
 * what tells someone facing a twenty-variable snippet what they are in for before they start.
 *
 * Hand-rolled rather than `createInputBox`'s native `step`/`totalSteps` because `showQuickPick`
 * has no equivalent, and a counter that appears on the input boxes but not the pick lists would
 * look like a bug.
 */
function titleFor(index: number, total: number, label: string): string {
    const step = total > 1 ? `(${index + 1}/${total}) ` : '';
    return `${step}${label}`;
}

/**
 * Collects every answer, or `undefined` the moment the user presses Esc.
 *
 * All-or-nothing is the contract the caller depends on: a half-filled prompt is worse than no
 * prompt, and because nothing is written until this resolves, cancelling leaves the clipboard
 * exactly as the user left it.
 *
 * `ignoreFocusOut` on every dialog: without it a stray click — including clicking into the editor
 * to check a variable name — discards what was typed, and across three dialogs that happens
 * constantly. The cost is that the editor stays live underneath, which is why the caller snapshots
 * everything it reads from the editor *before* calling this.
 */
export async function askInteractiveVariables(
    variables: readonly InteractiveVariable[],
    label: string,
): Promise<InteractiveValues | undefined> {
    // Not merely an optimisation: returning undefined here would read as "cancelled" and abort
    // every ordinary macro-only insert.
    if (variables.length === 0) {
        return new Map();
    }

    const answers = new Map<string, string>();
    for (const [index, variable] of variables.entries()) {
        const title = titleFor(index, variables.length, label);
        const answer =
            variable.prompt === 'pick'
                ? await vscode.window.showQuickPick([...variable.options], {
                      title,
                      placeHolder: `Choose a value for ${variable.name}`,
                      ignoreFocusOut: true,
                  })
                : await vscode.window.showInputBox({
                      title,
                      prompt: `Enter value for ${variable.name}`,
                      ignoreFocusOut: true,
                      // Every option is non-empty and the input box reports a deliberate empty
                      // answer as '', so undefined always means Esc and never "typed nothing".
                      // Adding `validateInput` would break that: rejecting empty input suppresses
                      // accept, and the two cases would become indistinguishable.
                      ...(variable.defaultValue.length > 0 ? { value: variable.defaultValue } : {}),
                  });

        if (answer === undefined) {
            // Stop at the first Esc. Asking the remaining variables would make the user fill in
            // a form that is already being thrown away.
            return undefined;
        }
        answers.set(variable.name, answer);
    }
    return answers;
}
