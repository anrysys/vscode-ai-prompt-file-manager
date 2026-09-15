import * as assert from 'node:assert';
import {
    fenceFor,
    renderTooltipMarkdown,
    truncateForTooltip,
    TOOLTIP_MAX_CHARS,
    TOOLTIP_MAX_LINES,
    TRUNCATION_NOTICE,
} from '../tree/tooltip';

suite('truncateForTooltip', () => {
    test('short content is passed through untouched', () => {
        const result = truncateForTooltip('line one\nline two');
        assert.strictEqual(result.text, 'line one\nline two');
        assert.strictEqual(result.truncated, false);
    });

    test('clips at the line limit', () => {
        const content = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
        const result = truncateForTooltip(content);

        assert.strictEqual(result.truncated, true);
        assert.strictEqual(result.text.split('\n').length, TOOLTIP_MAX_LINES);
        assert.ok(result.text.startsWith('line 1\n'));
        assert.ok(!result.text.includes(`line ${TOOLTIP_MAX_LINES + 1}`));
    });

    test('clips at the character limit even on a single enormous line', () => {
        const result = truncateForTooltip('x'.repeat(5000));
        assert.strictEqual(result.truncated, true);
        assert.strictEqual(result.text.length, TOOLTIP_MAX_CHARS);
    });

    test('exactly at the line limit is not reported as truncated', () => {
        const content = Array.from({ length: TOOLTIP_MAX_LINES }, (_, i) => `l${i}`).join('\n');
        assert.strictEqual(truncateForTooltip(content).truncated, false);
    });

    test('normalises CRLF so the line count is not doubled', () => {
        const result = truncateForTooltip('a\r\nb\r\nc');
        assert.strictEqual(result.text, 'a\nb\nc');
    });

    test('trailing blank lines are trimmed rather than padding the card', () => {
        assert.strictEqual(truncateForTooltip('body\n\n\n   ').text, 'body');
    });

    test('an empty file yields empty text', () => {
        assert.strictEqual(truncateForTooltip('').text, '');
        assert.strictEqual(truncateForTooltip('').truncated, false);
    });

    test('honours explicit limits', () => {
        const result = truncateForTooltip('a\nb\nc\nd', 100, 2);
        assert.strictEqual(result.text, 'a\nb');
        assert.strictEqual(result.truncated, true);
    });
});

suite('fenceFor', () => {
    test('uses three backticks for ordinary content', () => {
        assert.strictEqual(fenceFor('plain text'), '```');
    });

    test('outgrows a fence contained in the content', () => {
        // A prompt about Markdown would otherwise close the block early and let the rest
        // of the body render as live Markdown.
        assert.strictEqual(fenceFor('see ```js\ncode\n```'), '````');
        assert.strictEqual(fenceFor('````\nnested\n````'), '`````');
    });

    test('inline code does not inflate the fence beyond the minimum', () => {
        assert.strictEqual(fenceFor('use `npm test` here'), '```');
    });
});

suite('renderTooltipMarkdown', () => {
    const base = { fsPath: '/home/anry/prompts/review.md', size: 2048 };

    test('shows the body first, then the metadata', () => {
        const md = renderTooltipMarkdown({
            ...base,
            preview: { text: '# Review\n\nCheck the diff.', truncated: false },
        });

        assert.ok(md.startsWith('```md\n# Review'), md);
        assert.ok(md.includes('`/home/anry/prompts/review.md`'));
        assert.ok(md.includes('2.0 KB'));
        assert.ok(md.includes('Click to open, insert icon to paste'));
        assert.ok(!md.includes(TRUNCATION_NOTICE));
    });

    test('appends the truncation notice inside the body', () => {
        const md = renderTooltipMarkdown({
            ...base,
            preview: { text: 'first line', truncated: true },
        });
        assert.ok(md.includes(`first line\n\n${TRUNCATION_NOTICE}`), md);
    });

    test('the body is fenced so Markdown prompts do not render as formatting', () => {
        const md = renderTooltipMarkdown({
            ...base,
            preview: { text: '```js\nconst a = 1;\n```', truncated: false },
        });
        // The outer fence must be longer than the inner one.
        assert.ok(md.includes('````md\n```js'), md);
        assert.ok(md.includes('```\n````'), md);
    });

    test('an empty file says so instead of showing a blank block', () => {
        const md = renderTooltipMarkdown({ ...base, preview: { text: '', truncated: false } });
        assert.ok(md.includes('_(empty file)_'));
        assert.ok(!md.includes('```'));
    });

    test('a failure note replaces the body but keeps the metadata', () => {
        const md = renderTooltipMarkdown({ ...base, note: 'Too large to preview (4.0 MB).' });
        assert.ok(md.includes('_Too large to preview (4.0 MB)._'));
        assert.ok(md.includes('`/home/anry/prompts/review.md`'));
        assert.ok(!md.includes('```'));
    });
});
