//----------------------------------------------------------------------------------------------------------------------
// Branding Engine — theme document to stylesheet
//
// The stylesheet contract: a stock theme renders to NOTHING (the build-time look is the default, not a copy);
// set knobs land as token variables in a :root block; custom CSS lands verbatim and LAST, so the escape hatch
// out-cascades anything the tokens said.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { defaultInstanceTheme } from '@fileshed/core';

// Engines
import { renderBrandingCSS } from '@server/engines/branding.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('renderBrandingCSS', () =>
{
    it('renders a fully stock theme to an empty string', () =>
    {
        expect(renderBrandingCSS(defaultInstanceTheme)).toBe('');
    });

    it('renders set knobs as token variables in a :root block, the picked primary verbatim at 500', () =>
    {
        const css = renderBrandingCSS({ ...defaultInstanceTheme, primary: '#3b82f6', radius: 0.5 });

        expect(css).toContain(':root {');
        expect(css).toContain('--ui-color-primary-500: #3b82f6;');
        expect(css).toContain('--ui-radius: 0.5rem;');
    });

    it('appends custom CSS verbatim and last', () =>
    {
        const custom = '.sidebar { border: none !important; }';
        const css = renderBrandingCSS({ ...defaultInstanceTheme, primary: '#3b82f6', customCSS: custom });

        expect(css).toContain(custom);
        expect(css.indexOf(custom)).toBeGreaterThan(css.indexOf(':root {'));
    });

    it('renders a custom-CSS-only theme without any :root block', () =>
    {
        const css = renderBrandingCSS({ ...defaultInstanceTheme, customCSS: 'body { letter-spacing: 1px; }' });

        expect(css).not.toContain(':root');
        expect(css).toContain('body { letter-spacing: 1px; }');
    });

    it('mode and forcedMode never reach the stylesheet -- they are client behavior, not CSS', () =>
    {
        expect(renderBrandingCSS({ ...defaultInstanceTheme, mode: 'dark', forcedMode: true })).toBe('');
    });
});

//----------------------------------------------------------------------------------------------------------------------
