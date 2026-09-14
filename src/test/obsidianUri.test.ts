import * as assert from 'node:assert';
import {
    buildObsidianUri,
    needsVaultName,
    renderObsidianTemplate,
    toExternalString,
    unsupportedCharacters,
} from '../obsidian/obsidianUri';

const PATH_TEMPLATE = 'obsidian://open?path={absolutePath}';
const VAULT_TEMPLATE = 'obsidian://open?vault={vault}&file={relativePath}';

function cfg(uriTemplate: string, vaultName = '') {
    return { uriTemplate, vaultName };
}

/**
 * The string that actually reaches the operating system. VS Code's opener computes
 * `encodeURI(uri.toString(true))`, so this is what the assertions below check -- asserting
 * on the intermediate Uri would miss the double-encoding bug entirely.
 */
function handoff(absolutePath: string, template = PATH_TEMPLATE, relativePath = '', vault = '') {
    return toExternalString(
        buildObsidianUri({ absolutePath, relativePath }, cfg(template, vault)),
    );
}

suite('renderObsidianTemplate', () => {
    test('substitutes literally, because openExternal does the encoding itself', () => {
        assert.strictEqual(
            renderObsidianTemplate(
                'path={absolutePath}',
                { absolutePath: '/a b/c.md', relativePath: '' },
                cfg(PATH_TEMPLATE),
            ),
            'path=/a b/c.md',
        );
    });

    test('an unset placeholder renders empty rather than leaking the brace syntax', () => {
        assert.strictEqual(
            renderObsidianTemplate(
                'vault={vault}',
                { absolutePath: '/a.md', relativePath: '' },
                cfg(VAULT_TEMPLATE),
            ),
            'vault=',
        );
    });
});

suite('the URI handed to the operating system', () => {
    test('encodes a plain POSIX path', () => {
        assert.strictEqual(
            handoff('/home/anry/prompts/review.md'),
            'obsidian://open?path=/home/anry/prompts/review.md',
        );
    });

    test('encodes spaces exactly once', () => {
        const result = handoff('/home/anry/Obsidian Vault/code review.md');
        assert.strictEqual(
            result,
            'obsidian://open?path=/home/anry/Obsidian%20Vault/code%20review.md',
        );
        // The regression this whole module exists to prevent.
        assert.ok(!result.includes('%2520'), `double-encoded: ${result}`);
    });

    test('encodes non-ASCII exactly once', () => {
        const result = handoff('/home/anry/prompts/обзор.md');
        assert.strictEqual(
            result,
            'obsidian://open?path=/home/anry/prompts/%D0%BE%D0%B1%D0%B7%D0%BE%D1%80.md',
        );
        assert.ok(!result.includes('%25D0'), `double-encoded: ${result}`);
    });

    test('encodes a Windows path', () => {
        assert.strictEqual(
            handoff('C:\\Users\\anry\\prompts\\review.md'),
            'obsidian://open?path=C:%5CUsers%5Canry%5Cprompts%5Creview.md',
        );
    });

    test('encodes a literal percent exactly once', () => {
        assert.strictEqual(
            handoff('/home/anry/prompts/100%done.md'),
            'obsidian://open?path=/home/anry/prompts/100%25done.md',
        );
    });

    test('fills the vault and relative path form', () => {
        assert.strictEqual(
            handoff('/vault/prompts/review.md', VAULT_TEMPLATE, 'prompts/review.md', 'My Vault'),
            'obsidian://open?vault=My%20Vault&file=prompts/review.md',
        );
    });

    test('a # in a file name is kept in the query, not turned into a fragment', () => {
        const uri = buildObsidianUri(
            { absolutePath: '/home/anry/prompts/issue#42.md', relativePath: '' },
            cfg(PATH_TEMPLATE),
        );
        assert.strictEqual(uri.fragment, '');
        assert.ok(uri.query.includes('issue#42.md'));
    });

    test('rejects a template that is not a URI', () => {
        assert.throws(() =>
            buildObsidianUri({ absolutePath: '/a/b.md', relativePath: '' }, cfg('not a uri')),
        );
    });
});

suite('unsupportedCharacters', () => {
    test('an ordinary path is supported', () => {
        assert.strictEqual(
            unsupportedCharacters(
                { absolutePath: '/home/anry/Obsidian Vault/обзор.md', relativePath: '' },
                cfg(PATH_TEMPLATE),
            ),
            undefined,
        );
    });

    test('flags the characters that cannot survive the re-encoding', () => {
        for (const char of ['#', '?', '&']) {
            assert.strictEqual(
                unsupportedCharacters(
                    { absolutePath: `/home/anry/a${char}b.md`, relativePath: '' },
                    cfg(PATH_TEMPLATE),
                ),
                char,
                `${char} should be reported as unsupported`,
            );
        }
    });

    test('only inspects values the template actually uses', () => {
        // relativePath carries a '#' but the path template never substitutes it.
        assert.strictEqual(
            unsupportedCharacters(
                { absolutePath: '/home/anry/ok.md', relativePath: 'a#b.md' },
                cfg(PATH_TEMPLATE),
            ),
            undefined,
        );
    });
});

suite('needsVaultName', () => {
    test('true only when the template wants a vault that is not configured', () => {
        assert.strictEqual(needsVaultName(cfg(VAULT_TEMPLATE, '')), true);
        assert.strictEqual(needsVaultName(cfg(VAULT_TEMPLATE, 'V')), false);
        assert.strictEqual(needsVaultName(cfg(PATH_TEMPLATE, '')), false);
    });
});
