import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { ContextKey } from '../constants';
import { ResourceClipboard } from '../state/resourceClipboard';

/**
 * The clipboard drives the Paste menu entry through a context key, so the key and the
 * contents have to stay in step -- a stale `true` leaves a Paste that does nothing.
 */

function trackedClipboard(): { clipboard: ResourceClipboard; keyValue: () => boolean | undefined } {
    let value: boolean | undefined;
    const clipboard = new ResourceClipboard((key, next) => {
        assert.strictEqual(key, ContextKey.clipboardHasItems);
        value = next;
    });
    return { clipboard, keyValue: () => value };
}

const uri = vscode.Uri.file('/prompts/a.md');

suite('ResourceClipboard', () => {
    test('starts empty', () => {
        const { clipboard } = trackedClipboard();
        assert.strictEqual(clipboard.read(), undefined);
    });

    test('remembers the mode alongside the items', () => {
        const { clipboard, keyValue } = trackedClipboard();
        clipboard.set('cut', [uri]);

        assert.strictEqual(clipboard.read()?.mode, 'cut');
        assert.strictEqual(clipboard.read()?.uris.length, 1);
        assert.strictEqual(keyValue(), true, 'Paste should become available');
    });

    test('clearing hides the paste entry again', () => {
        const { clipboard, keyValue } = trackedClipboard();
        clipboard.set('copy', [uri]);
        clipboard.clear();

        assert.strictEqual(clipboard.read(), undefined);
        assert.strictEqual(keyValue(), false);
    });

    test('setting an empty list counts as clearing, not as an empty paste', () => {
        const { clipboard, keyValue } = trackedClipboard();
        clipboard.set('copy', []);
        assert.strictEqual(clipboard.read(), undefined);
        assert.strictEqual(keyValue(), false);
    });

    test('the stored list is a snapshot, not a live reference', () => {
        const { clipboard } = trackedClipboard();
        const uris = [uri];
        clipboard.set('copy', uris);
        uris.push(vscode.Uri.file('/prompts/b.md'));

        assert.strictEqual(clipboard.read()?.uris.length, 1);
    });
});
