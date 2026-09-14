import * as vscode from 'vscode';

export interface ObsidianConfig {
    readonly uriTemplate: string;
    readonly vaultName: string;
}

export interface ObsidianTarget {
    readonly absolutePath: string;
    readonly relativePath: string;
}

/** Matches `scheme://authority/path?query#fragment`, everything after the scheme optional. */
const URI_SHAPE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

const PLACEHOLDER = /\{(absolutePath|relativePath|vault)\}/g;

/**
 * Characters that cannot survive the trip through `env.openExternal`.
 *
 * VS Code minimally encodes them inside a query (`#` becomes `%23`) and then applies
 * `encodeURI` to the whole string, which escapes the `%` again into `%2523`. There is no
 * way to emit a percent-encoded byte through the Uri overload, so these are reported to
 * the user instead of being silently mangled.
 */
const UNSUPPORTED_IN_VALUE = /[#?&]/;

function valuesFor(target: ObsidianTarget, cfg: ObsidianConfig): Record<string, string> {
    return {
        absolutePath: target.absolutePath,
        relativePath: target.relativePath,
        vault: cfg.vaultName,
    };
}

/**
 * Substitutes placeholders **literally**, with no percent-encoding.
 *
 * This is deliberate: `env.openExternal` runs `encodeURI()` over the final string itself,
 * and `encodeURI` escapes `%`. Anything encoded here would therefore arrive double-encoded
 * (`%20` turning into `%2520`), which is exactly the bug this function exists to avoid.
 */
export function renderObsidianTemplate(
    template: string,
    target: ObsidianTarget,
    cfg: ObsidianConfig,
): string {
    const values = valuesFor(target, cfg);
    return template.replace(PLACEHOLDER, (_match, key: string) => values[key] ?? '');
}

/**
 * Builds the Uri handed to `env.openExternal`.
 *
 * The *template* is split into components before substitution, never the rendered string:
 * a `#` inside a file name would otherwise be parsed as the start of a fragment.
 */
export function buildObsidianUri(target: ObsidianTarget, cfg: ObsidianConfig): vscode.Uri {
    const match = URI_SHAPE.exec(cfg.uriTemplate);
    if (!match) {
        throw new Error(
            `promptManager.obsidian.uriTemplate is not a valid URI: ${cfg.uriTemplate}`,
        );
    }
    const [, scheme, authority, path, query, fragment] = match;
    const render = (part: string | undefined): string =>
        part ? renderObsidianTemplate(part, target, cfg) : '';

    return vscode.Uri.from({
        scheme: scheme ?? 'obsidian',
        authority: render(authority),
        path: render(path),
        query: render(query),
        fragment: render(fragment),
    });
}

/**
 * The exact string VS Code will hand to the operating system.
 * Mirrors `encodeURI(uri.toString(true))` from the workbench opener, so it is what should
 * be logged and what the "Copy URI" fallback offers.
 */
export function toExternalString(uri: vscode.Uri): string {
    return encodeURI(uri.toString(true));
}

/** True when the template asks for a vault name that has not been configured. */
export function needsVaultName(cfg: ObsidianConfig): boolean {
    return cfg.uriTemplate.includes('{vault}') && cfg.vaultName.trim().length === 0;
}

/**
 * Returns the characters in a substituted value that cannot round-trip, or undefined when
 * the target is safe to open.
 */
export function unsupportedCharacters(
    target: ObsidianTarget,
    cfg: ObsidianConfig,
): string | undefined {
    const used = new Set<string>();
    for (const [, key] of cfg.uriTemplate.matchAll(PLACEHOLDER)) {
        const value = valuesFor(target, cfg)[key!] ?? '';
        for (const char of value) {
            if (UNSUPPORTED_IN_VALUE.test(char)) {
                used.add(char);
            }
        }
    }
    return used.size > 0 ? [...used].join(' ') : undefined;
}
