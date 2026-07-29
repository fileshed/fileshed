//----------------------------------------------------------------------------------------------------------------------
// Theme Variables — the theme-to-CSS-custom-properties contract
//
// A stock theme emits NOTHING (the build-time look must stay untouched); each set knob emits exactly its own
// variables; and the five neutral palettes are pinned verbatim against the installed tailwindcss theme, so a
// Tailwind bump that shifts a gray fails here instead of silently drifting the chrome.
//----------------------------------------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    buildThemeVariables,
    defaultInstanceTheme,
    neutralFamilies,
    neutralPalettes,
    shadeKeys,
    stockBrandRamps,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('buildThemeVariables', () =>
{
    it('emits nothing for the stock theme', () =>
    {
        expect(buildThemeVariables(defaultInstanceTheme)).toEqual({});
    });

    it('emits the full primary ramp with the picked hex verbatim at 500', () =>
    {
        const variables = buildThemeVariables({ ...defaultInstanceTheme, primary: '#3b82f6' });

        expect(Object.keys(variables)).toHaveLength(shadeKeys.length);
        expect(variables['--ui-color-primary-500']).toBe('#3b82f6');
        expect(variables['--ui-color-primary-50']).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('emits the chosen neutral family verbatim from the pinned palette', () =>
    {
        const variables = buildThemeVariables({ ...defaultInstanceTheme, neutral: 'slate' });

        expect(Object.keys(variables)).toHaveLength(shadeKeys.length);
        expect(variables['--ui-color-neutral-500']).toBe(neutralPalettes.slate['500']);
    });

    it('emits the radius in rem', () =>
    {
        expect(buildThemeVariables({ ...defaultInstanceTheme, radius: 0.5 }))
            .toEqual({ '--ui-radius': '0.5rem' });
    });

    it('mode, forcedMode, and customCSS never emit variables -- they are not token knobs', () =>
    {
        expect(buildThemeVariables({
            ...defaultInstanceTheme,
            mode: 'dark',
            forcedMode: true,
            customCSS: 'body { outline: 1px solid red; }',
        })).toEqual({});
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('neutralPalettes', () =>
{
    it('mirrors the installed tailwindcss theme verbatim', () =>
    {
        const require = createRequire(import.meta.url);
        const theme = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8');

        for(const family of neutralFamilies)
        {
            for(const shade of shadeKeys)
            {
                const match = new RegExp(`--color-${ family }-${ shade }: ([^;]+);`).exec(theme);
                expect(match?.[1], `${ family }-${ shade }`).toBe(neutralPalettes[family][shade]);
            }
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('stockBrandRamps', () =>
{
    it('mirrors the shed palette in the client stylesheet verbatim', () =>
    {
        const mainCss = readFileSync(
            fileURLToPath(new URL('../../../src/client/src/styles/main.css', import.meta.url)),
            'utf8'
        );

        for(const shade of shadeKeys)
        {
            const match = new RegExp(`--color-shed-${ shade }: ([^;]+);`).exec(mainCss);
            expect(match?.[1], `shed-${ shade }`).toBe(stockBrandRamps.primary[shade]);
        }
    });

    it('mirrors the installed tailwindcss violet verbatim', () =>
    {
        const require = createRequire(import.meta.url);
        const theme = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8');

        for(const shade of shadeKeys)
        {
            const match = new RegExp(`--color-violet-${ shade }: ([^;]+);`).exec(theme);
            expect(match?.[1], `violet-${ shade }`).toBe(stockBrandRamps.secondary[shade]);
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------
