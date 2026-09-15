/**
 * Macro syntax, kept free of `vscode` so the substitution rules can be reasoned about and
 * tested on their own. Resolving the actual *values* lives in ./macroResolver.ts.
 */

/** The only names that get substituted. Anything else in `{{...}}` is left alone. */
export const MACRO_NAMES = ['selection', 'active_file', 'clipboard'] as const;

export type MacroName = (typeof MACRO_NAMES)[number];

/** One fully-populated set of values for a single expansion pass. */
export type MacroValues = Readonly<Record<MacroName, string>>;

/**
 * `{{name}}`, with optional spaces or tabs inside the braces.
 *
 * The name class is deliberately wider than the three known macros: every `{{word}}` is
 * matched so that the *replacer*, not the regex, decides what is known. That is what keeps
 * an unknown `{{foo}}` byte-for-byte intact instead of half-consumed by a partial match.
 *
 * Horizontal whitespace only: `{{\n selection \n}}` is not a macro, so a fenced code block
 * that happens to wrap across lines cannot be eaten.
 */
const MACRO_PATTERN = /\{\{[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\}\}/g;

function isMacroName(name: string): name is MacroName {
    return (MACRO_NAMES as readonly string[]).includes(name);
}

/**
 * The known macros actually present in `text`, so the caller can resolve only those.
 *
 * `matchAll` works on its own clone of the pattern, so the shared module-level regex's
 * `lastIndex` is never mutated here. `MACRO_PATTERN.test()` *would* mutate it, so there is
 * deliberately no `.test()` fast path — use `collectMacroNames(text).size === 0` instead.
 */
export function collectMacroNames(text: string): Set<MacroName> {
    const found = new Set<MacroName>();
    for (const match of text.matchAll(MACRO_PATTERN)) {
        const name = match[1];
        if (name !== undefined && isMacroName(name)) {
            found.add(name);
        }
    }
    return found;
}

/**
 * Substitutes the known macros in one left-to-right pass over the input.
 *
 * Single pass is the whole point. `String.prototype.replace` with a global regex walks the
 * *input* string and appends each replacement to an output buffer that it never re-scans,
 * so a clipboard whose contents are literally `{{selection}}` lands in the result verbatim
 * instead of being expanded a second time. A chain of three `.replace('{{x}}', value)`
 * calls would not have that property — each call re-reads what the previous one produced.
 *
 * The replacer is a function rather than a string for a second reason: `$&`, `$1` and `$'`
 * are only special inside a *string* replacement, so a pasted `$1` survives intact here.
 */
export function expandMacros(text: string, values: MacroValues): string {
    return text.replace(MACRO_PATTERN, (match: string, name: string) =>
        isMacroName(name) ? values[name] : match,
    );
}
