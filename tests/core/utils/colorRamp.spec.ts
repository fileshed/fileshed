//----------------------------------------------------------------------------------------------------------------------
// Color Ramp — one picked hex to Nuxt UI's eleven shades
//
// The contract: the pick IS shade 500 verbatim, lightness orders strictly from 50 down to 950, every shade is a
// valid in-gamut #rrggbb even for a maximally saturated pick, neutrals stay neutral, and degenerate near-white
// picks still produce an ordered ramp. Ordering is asserted through contrastRatio against black -- luminance,
// via the public surface -- never by re-deriving the engine's own color math.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { colorRamp, contrastRatio, parseHexColor, shadeKeys, themeColorToHex } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const BLACK = '#000000';
const WHITE = '#ffffff';

//----------------------------------------------------------------------------------------------------------------------

describe('colorRamp', () =>
{
    it('anchors the picked color verbatim as shade 500', () =>
    {
        expect(colorRamp('#3B82F6')['500']).toBe('#3b82f6');
    });

    it('orders lightness strictly from 50 down to 950', () =>
    {
        const ramp = colorRamp('#3b82f6');
        const luminances = shadeKeys.map((shade) => contrastRatio(ramp[shade], BLACK));

        for(let i = 1; i < luminances.length; i++)
        {
            expect(luminances[i]).toBeLessThan(luminances[i - 1] ?? Infinity);
        }
    });

    it('lands every shade in gamut as a valid #rrggbb, even for a maximally saturated pick', () =>
    {
        for(const pick of [ '#ff0000', '#00ff00', '#0000ff', '#ff00ff' ])
        {
            const ramp = colorRamp(pick);

            for(const shade of shadeKeys)
            {
                expect(ramp[shade]).toMatch(/^#[0-9a-f]{6}$/);
            }
        }
    });

    it('keeps a neutral pick neutral in every shade', () =>
    {
        const ramp = colorRamp('#808080');

        for(const shade of shadeKeys)
        {
            const channels = parseHexColor(ramp[shade]);
            expect(channels).not.toBeNull();

            const bytes = (channels ?? []).map((channel) => Math.round(channel * 255));
            expect(Math.max(...bytes) - Math.min(...bytes)).toBeLessThanOrEqual(1);
        }
    });

    it('keeps a near-white pick ordered instead of collapsing the light end', () =>
    {
        const ramp = colorRamp('#f5f0ff');
        const luminances = shadeKeys.map((shade) => contrastRatio(ramp[shade], BLACK));

        for(let i = 1; i < luminances.length; i++)
        {
            expect(luminances[i]).toBeLessThan(luminances[i - 1] ?? Infinity);
        }
    });

    it('refuses a malformed pick', () =>
    {
        expect(() => colorRamp('teal')).toThrow(/#rrggbb/);
        expect(() => colorRamp('#fff')).toThrow(/#rrggbb/);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('themeColorToHex', () =>
{
    it('passes hex through lowercased and anchors the oklch extremes exactly', () =>
    {
        expect(themeColorToHex('#3B82F6')).toBe('#3b82f6');
        expect(themeColorToHex('oklch(100% 0 none)')).toBe('#ffffff');
        expect(themeColorToHex('oklch(0% 0 none)')).toBe('#000000');
    });

    it('converts a Tailwind-style oklch token to a valid in-gamut hex', () =>
    {
        expect(themeColorToHex('oklch(60.6% 0.25 292.717)')).toMatch(/^#[0-9a-f]{6}$/);
        expect(themeColorToHex('oklch(0.606 0.25 292.717)')).toBe(themeColorToHex('oklch(60.6% 0.25 292.717)'));
    });

    it('answers null for anything it cannot honestly convert', () =>
    {
        expect(themeColorToHex('')).toBeNull();
        expect(themeColorToHex('rebeccapurple')).toBeNull();
        expect(themeColorToHex('rgb(1, 2, 3)')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('contrastRatio', () =>
{
    it('answers 21 for black on white and 1 for a color on itself', () =>
    {
        expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1);
        expect(contrastRatio('#3b82f6', '#3b82f6')).toBe(1);
    });

    it('is symmetric in its arguments', () =>
    {
        expect(contrastRatio('#3b82f6', WHITE)).toBeCloseTo(contrastRatio(WHITE, '#3b82f6'), 10);
    });
});

//----------------------------------------------------------------------------------------------------------------------
