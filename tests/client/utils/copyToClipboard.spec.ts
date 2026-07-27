//----------------------------------------------------------------------------------------------------------------------
// Copy To Clipboard — the secure path, the insecure-origin fallback, and honest failure
//
// The contract: use the async clipboard API when the context has one; on a plain-HTTP origin (where
// navigator.clipboard does not exist at all) fall back to the legacy execCommand path rather than throwing; and
// report false when neither lands the text, so a caller can tell the user instead of pretending. jsdom ships
// neither API, which conveniently IS the insecure environment -- both are installed per case.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';

// Under test
import { copyToClipboard } from '@client/utils/copyToClipboard.ts';

//----------------------------------------------------------------------------------------------------------------------

function installClipboard(writeText : (text : string) => Promise<void>) : void
{
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

afterEach(() =>
{
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
});

//----------------------------------------------------------------------------------------------------------------------

describe('copyToClipboard', () =>
{
    it('uses the async clipboard API where it exists', async () =>
    {
        const writeText = vi.fn(() => Promise.resolve());
        installClipboard(writeText);

        expect(await copyToClipboard('fspat_secret')).toBe(true);
        expect(writeText).toHaveBeenCalledWith('fspat_secret');
    });

    it('falls back to the legacy path on an insecure origin, cleaning up its scratch element', async () =>
    {
        const execCommand = vi.fn(() => true);
        Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

        expect(await copyToClipboard('fspat_secret')).toBe(true);
        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('falls back to the legacy path when the clipboard API refuses permission', async () =>
    {
        installClipboard(() => Promise.reject(new Error('denied')));
        Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) });

        expect(await copyToClipboard('fspat_secret')).toBe(true);
    });

    it('reports false when no copy mechanism lands the text', async () =>
    {
        expect(await copyToClipboard('fspat_secret')).toBe(false);
        expect(document.querySelector('textarea')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
