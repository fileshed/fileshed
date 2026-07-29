//----------------------------------------------------------------------------------------------------------------------
// Instance Theme Codec — the one-document brand contract
//
// An empty document parses to the stock theme (null overrides, system mode, nothing forced); the read side never
// throws -- a hand-edited or future-versioned row collapses to stock rather than failing the instance render;
// and the PATCH codec is strict: bad hexes, out-of-range radii, and misspelled fields are bugs to surface, not
// values to store.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    defaultInstanceTheme,
    instanceThemeCodec,
    toInstanceTheme,
    updateBrandingRequestCodec,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('instanceThemeCodec', () =>
{
    it('parses an empty document to the stock theme', () =>
    {
        expect(instanceThemeCodec.parse({})).toEqual(defaultInstanceTheme);
    });

    it('keeps a stored override document intact', () =>
    {
        const stored = {
            primary: '#3b82f6',
            secondary: null,
            neutral: 'slate',
            radius: 0.5,
            mode: 'dark',
            forcedMode: true,
            customCSS: '.sidebar { border: none; }',
        };

        expect(instanceThemeCodec.parse(stored)).toEqual(stored);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('toInstanceTheme', () =>
{
    it('collapses a malformed document to stock instead of failing the read', () =>
    {
        expect(toInstanceTheme({ primary: 'not-a-color', radius: 99 })).toEqual(defaultInstanceTheme);
        expect(toInstanceTheme('scribbles')).toEqual(defaultInstanceTheme);
        expect(toInstanceTheme(null)).toEqual(defaultInstanceTheme);
    });

    it('drops unknown keys from the view without failing', () =>
    {
        const theme = toInstanceTheme({ primary: '#112233', futureKnob: 'whatever' });

        expect(theme.primary).toBe('#112233');
        expect('futureKnob' in theme).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('updateBrandingRequestCodec', () =>
{
    it('accepts a sparse patch, lowercasing hexes and passing explicit nulls through as unsets', () =>
    {
        expect(updateBrandingRequestCodec.parse({ primary: '#FF8800', radius: null }))
            .toEqual({ primary: '#ff8800', radius: null });
    });

    it('rejects a bad hex, an out-of-range radius, and an unknown field', () =>
    {
        expect(updateBrandingRequestCodec.safeParse({ primary: 'red' }).success).toBe(false);
        expect(updateBrandingRequestCodec.safeParse({ radius: 1.5 }).success).toBe(false);
        expect(updateBrandingRequestCodec.safeParse({ radius: -0.1 }).success).toBe(false);
        expect(updateBrandingRequestCodec.safeParse({ primry: '#112233' }).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
