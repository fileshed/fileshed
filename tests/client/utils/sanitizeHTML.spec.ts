//----------------------------------------------------------------------------------------------------------------------
// Sanitize HTML — markdown HTML made safe to render
//
// The contract: scripts, inline event handlers, javascript: links, style elements and form controls are removed, and
// the elements and attributes HTML formats with are kept. Links open in a new tab without telling the site where the
// reader came from. The result says whether the HTML draws anything: text or an image does, an empty anchor or a
// removed script doesn't.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Under test
import { sanitizeHTML } from '@client/utils/sanitizeHTML.ts';

//----------------------------------------------------------------------------------------------------------------------

function parse(html : string) : HTMLElement
{
    const holder = document.createElement('div');
    holder.innerHTML = html;

    return holder;
}

//----------------------------------------------------------------------------------------------------------------------

describe('sanitizeHTML', () =>
{
    it('removes scripts, inline event handlers and javascript: links', () =>
    {
        const source = '<p onclick="steal()">Hi<script>steal()</script> <a href="javascript:steal()">there</a></p>';

        const sanitized = parse(sanitizeHTML(source).html);

        expect(sanitized.querySelector('script')).toBeNull();
        expect(sanitized.querySelector('[onclick]')).toBeNull();
        expect(sanitized.querySelector('a')?.hasAttribute('href')).toBe(false);
        expect(sanitized.textContent).toBe('Hi there');
    });

    it('removes style elements and form controls', () =>
    {
        const source = '<style>body { display: none }</style><form action="/login"><input name="password">'
            + '<button>Go</button><select></select><textarea></textarea></form>';

        const sanitized = parse(sanitizeHTML(source).html);

        expect(sanitized.querySelector('style, form, input, button, select, textarea')).toBeNull();
    });

    it('keeps the elements and attributes HTML formats with', () =>
    {
        const source = '<div align="center"><b>Bold</b> <kbd>Ctrl</kbd> <img src="logo.png" alt="Logo"></div>';

        const sanitized = parse(sanitizeHTML(source).html);

        expect(sanitized.querySelector('div[align="center"] > b')?.textContent).toBe('Bold');
        expect(sanitized.querySelector('kbd')?.textContent).toBe('Ctrl');
        expect(sanitized.querySelector('img[src="logo.png"][alt="Logo"]')).not.toBeNull();
    });

    it('opens links in a new tab without telling the site where the reader came from', () =>
    {
        const link = parse(sanitizeHTML('<a href="https://example.com">site</a>').html).querySelector('a');

        expect(link?.getAttribute('target')).toBe('_blank');
        expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('reports HTML with text, an image or a rule as drawing something', () =>
    {
        expect(sanitizeHTML('<span>Hi</span>').visible).toBe(true);
        expect(sanitizeHTML('<img src="logo.png">').visible).toBe(true);
        expect(sanitizeHTML('<hr>').visible).toBe(true);
    });

    it('reports HTML that draws nothing once sanitized', () =>
    {
        expect(sanitizeHTML('<a name="anchor"></a>').visible).toBe(false);
        expect(sanitizeHTML('<script>alert(1)</script>').visible).toBe(false);
        expect(sanitizeHTML('<div>   </div>').visible).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
