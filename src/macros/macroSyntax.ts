/**
 * Macro syntax, kept free of `vscode` so the substitution rules can be reasoned about and
 * tested on their own. Resolving the actual *values* lives in ./macroResolver.ts, and
 * asking the user for the interactive ones lives in ./interactivePrompt.ts.
 */

/** The only names that get substituted from window state. Anything else is left alone. */
export const MACRO_NAMES = ['selection', 'active_file', 'clipboard'] as const;

export type MacroName = (typeof MACRO_NAMES)[number];

/** One fully-populated set of values for a single expansion pass. */
export type MacroValues = Readonly<Record<MacroName, string>>;

/**
 * A variable the user is asked about before the text is inserted.
 *
 * `{{?Language}}`, `{{?Language=Rust}}` or `{{?Language:Rust|Go|Python}}`.
 */
export interface InteractiveVariable {
    readonly name: string;
    readonly prompt: 'input' | 'pick';
    /** Pre-filled into the input box. Empty unless the `=` form was used. */
    readonly defaultValue: string;
    /** Non-empty only for the `pick` form. */
    readonly options: readonly string[];
}

/**
 * Answers keyed by variable name.
 *
 * A Map rather than an object because the name class is deliberately permissive: `{{?__proto__}}`
 * and `{{?toString}}` are legal names, and a plain object would answer those lookups with inherited
 * junk — `function toString() { [native code] }` substituted into someone's prompt.
 */
export type InteractiveValues = ReadonlyMap<string, string>;

const NO_ANSWERS: InteractiveValues = new Map();

/**
 * `{{body}}`, with an optional escaping backslash in front.
 *
 * The body class is deliberately wider than any construct we understand: every `{{...}}` is matched
 * so that the *replacer*, not the regex, decides what is known. That is what keeps an unknown
 * `{{foo}}` byte-for-byte intact instead of half-consumed by a partial match.
 *
 * Because the body excludes braces, a match can never contain a nested `{{`, so widening this
 * pattern cannot swallow a construct the narrower pre-0.1.13 pattern matched separately.
 *
 * Every line terminator is excluded — including U+2028 and U+2029, which `[\r\n]` misses — so
 * `{{\n selection \n}}` is not a macro and a fenced code block that happens to wrap across lines
 * cannot be eaten.
 */
const MACRO_PATTERN = /(\\?)\{\{([^{}\r\n\u2028\u2029\u0085]*)\}\}/g;

/**
 * The pre-0.1.13 name rule, anchored, used to classify a plain `{{name}}` body.
 *
 * Deliberately *not* `body.trim()`: `String.prototype.trim` strips the whole Unicode whitespace
 * set, so a non-breaking space pasted in from Word or Notion would turn `{{\u00A0selection}}` —
 * literal text in every released version — into an expanding macro. Horizontal ASCII whitespace
 * only, exactly as before.
 */
const PLAIN_BODY = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*$/;

/** What a `{{...}}` body turned out to be. `undefined` means "not ours, leave it alone". */
type ParsedBody =
    | { readonly kind: 'macro'; readonly name: MacroName }
    | { readonly kind: 'ask'; readonly variable: InteractiveVariable };

function isMacroName(name: string): name is MacroName {
    return (MACRO_NAMES as readonly string[]).includes(name);
}

/**
 * Parses the `?` form. Returns undefined for anything malformed, which the caller then treats
 * exactly like an unknown `{{foo}}`: left verbatim, so the author sees the typo in the output.
 *
 * The first `=` or `:` after the `?` is the separator, whichever comes first. So a default may
 * contain a colon (`{{?Time=12:00}}`) and an option may contain an equals (`{{?Op:a=b|c}}`).
 */
function parseInteractive(body: string): InteractiveVariable | undefined {
    if (!body.startsWith('?')) {
        return undefined;
    }
    const rest = body.slice(1);
    const equals = rest.indexOf('=');
    const colon = rest.indexOf(':');
    const separator =
        equals !== -1 && colon !== -1 ? Math.min(equals, colon) : equals !== -1 ? equals : colon;

    let name = rest;
    let prompt: 'input' | 'pick' = 'input';
    let defaultValue = '';
    let options: string[] = [];

    if (separator !== -1) {
        name = rest.slice(0, separator);
        const tail = rest.slice(separator + 1);
        if (rest[separator] === '=') {
            // Trimmed because trailing spaces are invisible in the input box, so they could only
            // ever be an accident. The user's *answer* is never trimmed.
            defaultValue = tail.trim();
        } else {
            prompt = 'pick';
            options = [...new Set(tail.split('|').map((o) => o.trim()).filter((o) => o.length > 0))];
            // A colon promised a list and delivered none: a typo, not an empty menu.
            if (options.length === 0) {
                return undefined;
            }
        }
    }

    name = name.trim();
    // A bare pipe outside an option list means a forgotten colon, e.g. `{{?Lang|Rust|Go}}`.
    if (name.length === 0 || name.includes('|')) {
        return undefined;
    }
    return { name, prompt, defaultValue, options };
}

/**
 * Classifies one body. The `?` form is tested first, so `{{?selection}}` is a variable *named*
 * "selection" rather than the built-in macro — the two namespaces never overlap.
 */
function parseBody(body: string): ParsedBody | undefined {
    const plain = PLAIN_BODY.exec(body);
    const name = plain?.[1];
    if (name !== undefined && isMacroName(name)) {
        return { kind: 'macro', name };
    }
    const variable = parseInteractive(body.trim());
    return variable ? { kind: 'ask', variable } : undefined;
}

interface ScannedMacro {
    readonly match: string;
    readonly body: string;
    /** True when a backslash immediately preceded the braces. */
    readonly escaped: boolean;
    readonly parsed: ParsedBody | undefined;
}

/**
 * The single scanner every public function here is built on.
 *
 * Four independent walks over the same grammar would drift apart silently — one deciding an
 * escaped variable is worth asking about while another refuses to substitute it, say — so there
 * is exactly one, and the callers only differ in what they do with each hit.
 *
 * `matchAll` works on its own clone of the pattern, so the shared module-level regex's `lastIndex`
 * is never mutated here. `MACRO_PATTERN.test()` *would* mutate it, so there is deliberately no
 * `.test()` fast path anywhere in this file.
 */
function* scan(text: string): Generator<ScannedMacro> {
    for (const match of text.matchAll(MACRO_PATTERN)) {
        const body = match[2] ?? '';
        yield {
            match: match[0],
            body,
            escaped: match[1] === '\\',
            parsed: parseBody(body),
        };
    }
}

/**
 * The known macros that will actually be substituted, so the caller can resolve only those.
 *
 * Escaped occurrences are excluded on purpose: `\{{clipboard}}` expands to literal text, and
 * resolving it anyway would pay for a clipboard round-trip whose result is thrown away.
 * Use `referencesMacro` when the question is "is this name mentioned at all".
 */
export function collectMacroNames(text: string): Set<MacroName> {
    const found = new Set<MacroName>();
    for (const hit of scan(text)) {
        if (!hit.escaped && hit.parsed?.kind === 'macro') {
            found.add(hit.parsed.name);
        }
    }
    return found;
}

/**
 * Whether `name` appears at all, escaped or not.
 *
 * The insert guard needs this rather than `collectMacroNames`, because an *escaped*
 * `\{{selection}}` still puts the literal text `{{selection}}` into the result — and writing that
 * over the code the user had highlighted destroys it just as thoroughly as the expansion would.
 */
export function referencesMacro(text: string, name: MacroName): boolean {
    for (const hit of scan(text)) {
        if (hit.parsed?.kind === 'macro' && hit.parsed.name === name) {
            return true;
        }
    }
    return false;
}

/**
 * The interactive variables to ask about, in order of first appearance, one entry per name.
 *
 * Order comes free from `Map`, which preserves insertion order, and matching reading order is
 * what makes the "(2/3)" counter in the dialogs mean anything.
 *
 * Escaped occurrences are skipped: asking for a value and then emitting the literal braces would
 * silently discard what the user typed.
 *
 * Among occurrences sharing a name, the first one *carrying a spec* wins. A bare `{{?Lang}}`
 * followed later by `{{?Lang:Rust|Go}}` reads as "reuse the value asked for elsewhere", and
 * letting the bare reference win would silently throw the option list away.
 */
export function collectInteractiveVariables(text: string): InteractiveVariable[] {
    const found = new Map<string, InteractiveVariable>();
    for (const hit of scan(text)) {
        if (hit.escaped || hit.parsed?.kind !== 'ask') {
            continue;
        }
        const variable = hit.parsed.variable;
        const existing = found.get(variable.name);
        if (!existing) {
            found.set(variable.name, variable);
            continue;
        }
        const existingIsBare = existing.options.length === 0 && existing.defaultValue.length === 0;
        const incomingHasSpec = variable.options.length > 0 || variable.defaultValue.length > 0;
        if (existingIsBare && incomingHasSpec) {
            found.set(variable.name, variable);
        }
    }
    return [...found.values()];
}

/**
 * Substitutes macros and answered variables in one left-to-right pass over the input.
 *
 * Single pass is the whole point. `String.prototype.replace` with a global regex walks the
 * *input* string and appends each replacement to an output buffer that it never re-scans, so a
 * clipboard whose contents are literally `{{selection}}` lands in the result verbatim instead of
 * being expanded a second time. A chain of `.replace('{{x}}', value)` calls would not have that
 * property — each call re-reads what the previous one produced.
 *
 * The replacer is a function rather than a string for a second reason: `$&`, `$1` and `$'` are
 * only special inside a *string* replacement, so a pasted `$1` survives intact here.
 *
 * `answers` is defaulted so the existing call sites, which are the regression suite for the
 * single-pass guarantee, keep working untouched.
 */
export function expandMacros(
    text: string,
    values: MacroValues,
    answers: InteractiveValues = NO_ANSWERS,
): string {
    return text.replace(MACRO_PATTERN, (match: string, _escape: string, body: string) => {
        const parsed = parseBody(body);
        // Not ours. Returned whole, so an unknown tag keeps any backslash it came with — adding
        // escaping cannot change text that had no macros in it.
        if (!parsed) {
            return match;
        }
        const escaped = match.startsWith('\\');
        if (escaped) {
            // The backslash is consumed only here, where it actually suppressed an expansion.
            return `{{${body}}}`;
        }
        if (parsed.kind === 'macro') {
            return values[parsed.name];
        }
        // An unanswered variable stays as written. Nothing should reach here — the resolver
        // collects every answer before expanding — but leaving the tag visible beats emitting
        // an empty hole that nobody can trace back to a missing answer.
        return answers.get(parsed.variable.name) ?? match;
    });
}
