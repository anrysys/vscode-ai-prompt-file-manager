import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    ensureExtension,
    expandPathTemplate,
    snippetFileName,
    labelFromFileName,
    relativePosix,
    resolveToUri,
    slugifyTitle,
    slugifyTitlePath,
    stripSnippetExtension,
    uriKey,
} from '../fs/paths';

const ctx = {
    homeDir: '/home/tester',
    workspaceFolder: '/work/project',
    env: { MY_PROMPTS: '/opt/prompts' } as NodeJS.ProcessEnv,
};

suite('expandPathTemplate', () => {
    test('expands a bare tilde and a tilde prefix', () => {
        assert.strictEqual(expandPathTemplate('~', ctx), '/home/tester');
        assert.strictEqual(expandPathTemplate('~/prompts', ctx), path.join('/home/tester', 'prompts'));
    });

    test('expands the supported variables', () => {
        assert.strictEqual(expandPathTemplate('${userHome}/p', ctx), '/home/tester/p');
        assert.strictEqual(expandPathTemplate('${workspaceFolder}/p', ctx), '/work/project/p');
        assert.strictEqual(expandPathTemplate('${env:MY_PROMPTS}/p', ctx), '/opt/prompts/p');
    });

    test('an undefined env var becomes empty rather than throwing', () => {
        assert.strictEqual(expandPathTemplate('${env:NOPE}/p', ctx), '/p');
    });

    test('an unknown variable is left intact so the typo stays visible', () => {
        assert.strictEqual(expandPathTemplate('${bogus}/p', ctx), '${bogus}/p');
    });

    test('workspaceFolder is left intact when there is no workspace', () => {
        assert.strictEqual(
            expandPathTemplate('${workspaceFolder}/p', { homeDir: '/home/tester' }),
            '${workspaceFolder}/p',
        );
    });

    test('empty and whitespace input yield empty', () => {
        assert.strictEqual(expandPathTemplate('   ', ctx), '');
    });
});

suite('resolveToUri', () => {
    test('empty input yields undefined so callers can fall back', () => {
        assert.strictEqual(resolveToUri('', undefined, ctx), undefined);
    });

    test('an absolute path is used as-is', () => {
        const uri = resolveToUri('/opt/prompts', undefined, ctx);
        assert.strictEqual(uri?.fsPath, path.resolve('/opt/prompts'));
    });

    test('a relative path resolves against the base when given', () => {
        const base = vscode.Uri.file('/work/project');
        const uri = resolveToUri('.vscode/prompts', base, ctx);
        assert.strictEqual(uri?.fsPath, path.join('/work/project', '.vscode', 'prompts'));
    });

    test('a relative path resolves against home when there is no base', () => {
        const uri = resolveToUri('prompts', undefined, ctx);
        assert.strictEqual(uri?.fsPath, path.resolve('/home/tester', 'prompts'));
    });
});

suite('relativePosix', () => {
    const root = vscode.Uri.file('/root/prompts');

    test('returns a posix path for a contained file', () => {
        assert.strictEqual(
            relativePosix(root, vscode.Uri.file('/root/prompts/a/b.md')),
            'a/b.md',
        );
    });

    test('returns undefined for a file outside the root', () => {
        assert.strictEqual(relativePosix(root, vscode.Uri.file('/root/other/b.md')), undefined);
    });

    test('the root itself is the empty path', () => {
        assert.strictEqual(relativePosix(root, root), '');
    });
});

suite('uriKey', () => {
    test('a trailing separator does not change the key', () => {
        assert.strictEqual(uriKey(vscode.Uri.file('/a/b/')), uriKey(vscode.Uri.file('/a/b')));
    });
});

suite('stripSnippetExtension', () => {
    const exts = ['.md', '.txt'];

    test('removes a known extension and leaves punctuation alone', () => {
        assert.strictEqual(stripSnippetExtension('code-review_v2.md', exts), 'code-review_v2');
        assert.strictEqual(stripSnippetExtension('Follow-up questions.md', exts), 'Follow-up questions');
    });

    test('matches case-insensitively', () => {
        assert.strictEqual(stripSnippetExtension('Notes.MD', exts), 'Notes');
    });

    test('leaves an unknown extension in place', () => {
        assert.strictEqual(stripSnippetExtension('script.sh', exts), 'script.sh');
    });

    test('a name that is only an extension is left alone, not emptied', () => {
        assert.strictEqual(stripSnippetExtension('.md', exts), '.md');
    });
});

suite('labelFromFileName', () => {
    const exts = ['.md', '.txt'];

    test('strips the extension and renders separators as spaces', () => {
        assert.strictEqual(labelFromFileName('code-review_v2.md', exts), 'code review v2');
        assert.strictEqual(labelFromFileName('notes.txt', exts), 'notes');
        assert.strictEqual(
            labelFromFileName('ROCKET-PROMPT-FOR-NEW-SESSION.md', exts),
            'ROCKET PROMPT FOR NEW SESSION',
        );
    });

    test('collapses runs of separators into a single space', () => {
        assert.strictEqual(labelFromFileName('a--b__c.md', exts), 'a b c');
        assert.strictEqual(labelFromFileName('-leading-and-trailing-.md', exts), 'leading and trailing');
    });

    test('matches the extension case-insensitively', () => {
        assert.strictEqual(labelFromFileName('Notes.MD', exts), 'Notes');
    });

    test('keeps an unknown extension visible', () => {
        assert.strictEqual(labelFromFileName('script.sh', exts), 'script.sh');
    });

    test('a name that is only separators falls back to the raw name', () => {
        assert.strictEqual(labelFromFileName('.md', exts), '.md');
        assert.strictEqual(labelFromFileName('---.md', exts), '---.md');
    });
});

suite('slugifyTitle', () => {
    test('slugifies an ordinary title', () => {
        assert.strictEqual(slugifyTitle('Code Review!'), 'Code-Review!');
        assert.strictEqual(slugifyTitle('  spaced   out  '), 'spaced-out');
    });

    test('strips characters that are illegal in a file name', () => {
        assert.strictEqual(slugifyTitle('a:b*c?d'), 'a-b-c-d');
    });

    test('rejects titles that reduce to nothing, including traversal attempts', () => {
        assert.strictEqual(slugifyTitle('..'), '');
        assert.strictEqual(slugifyTitle('.'), '');
        assert.strictEqual(slugifyTitle('///'), '');
        assert.strictEqual(slugifyTitle('   '), '');
    });
});

suite('slugifyTitlePath', () => {
    test('splits on separators to allow nesting', () => {
        assert.deepStrictEqual(slugifyTitlePath('review/security pass'), [
            'review',
            'security-pass',
        ]);
    });

    test('a traversal segment makes the whole title invalid', () => {
        assert.strictEqual(slugifyTitlePath('../etc/passwd'), undefined);
        assert.strictEqual(slugifyTitlePath('a/../b'), undefined);
    });

    test('an empty title is invalid', () => {
        assert.strictEqual(slugifyTitlePath('   '), undefined);
    });
});

suite('ensureExtension', () => {
    const exts = ['.md', '.txt'];

    test('leaves a known extension alone, case-insensitively', () => {
        assert.strictEqual(ensureExtension('a.md', exts, '.md'), 'a.md');
        assert.strictEqual(ensureExtension('a.TXT', exts, '.md'), 'a.TXT');
    });

    test('appends the fallback when there is none', () => {
        assert.strictEqual(ensureExtension('a', exts, '.md'), 'a.md');
    });

    test('never doubles the fallback, even when it is not in the list', () => {
        assert.strictEqual(ensureExtension('a.md', ['.txt'], '.md'), 'a.md');
    });
});

suite('snippetFileName', () => {
    const configured = ['.md', '.txt'];

    test('appends the configured extension to a bare title', () => {
        assert.strictEqual(snippetFileName('posts_and_articles', configured, '.md'), 'posts_and_articles.md');
    });

    test('a title that already ends in .md is used as-is', () => {
        assert.strictEqual(
            snippetFileName('posts_and_articles.md', configured, '.md'),
            'posts_and_articles.md',
        );
    });

    test('case does not matter', () => {
        assert.strictEqual(snippetFileName('Notes.MD', configured, '.md'), 'Notes.MD');
        assert.strictEqual(snippetFileName('Notes.Txt', configured, '.md'), 'Notes.Txt');
    });

    test('the other built-in format is respected too', () => {
        assert.strictEqual(snippetFileName('notes.txt', configured, '.md'), 'notes.txt');
    });

    test('a narrowed fileExtensions setting cannot cause a double extension', () => {
        // The regression: with fileExtensions = ['.txt'], '.md' used to be appended blindly.
        assert.strictEqual(snippetFileName('posts_and_articles.md', ['.txt'], '.md'), 'posts_and_articles.md');
        assert.strictEqual(snippetFileName('a.txt', ['.md'], '.md'), 'a.txt');
    });

    test('no title ever gains two snippet extensions', () => {
        const inputs = ['plain', 'posts.md', 'Notes.MD', 'a.txt', 'x.Md'];
        for (const configuredExts of [['.md', '.txt'], ['.txt'], ['.md']]) {
            for (const input of inputs) {
                const result = snippetFileName(input, configuredExts, '.md');
                assert.ok(
                    !/\.(md|txt)\.(md|txt)$/i.test(result),
                    `${input} with ${JSON.stringify(configuredExts)} produced ${result}`,
                );
            }
        }
    });

    test('an unrelated extension still gets one appended', () => {
        assert.strictEqual(snippetFileName('script.sh', configured, '.md'), 'script.sh.md');
    });
});
