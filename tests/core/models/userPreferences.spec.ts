//----------------------------------------------------------------------------------------------------------------------
// User Preferences Codec — the known view and its defensive read serializer
//
// userPreferencesCodec is the KNOWN view: it validates rootLabel (trimmed, 1..64 chars) and, being a plain object
// codec, drops any key it does not model. toUserPreferences is the read side used to assemble /api/me: it must never
// throw on an arbitrary stored blob -- unknown keys drop out of the view (they stay in storage), and a malformed known
// value collapses to the empty view rather than failing the profile read.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { toUserPreferences, userPreferencesCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('userPreferencesCodec', () =>
{
    it('trims surrounding whitespace from rootLabel', () =>
    {
        const result = userPreferencesCodec.parse({ rootLabel: '  Photos  ' });

        expect(result.rootLabel).toBe('Photos');
    });

    it('rejects a rootLabel longer than 64 characters', () =>
    {
        const result = userPreferencesCodec.safeParse({ rootLabel: 'a'.repeat(65) });

        expect(result.success).toBe(false);
    });

    it('rejects a rootLabel that is empty once trimmed', () =>
    {
        const result = userPreferencesCodec.safeParse({ rootLabel: '   ' });

        expect(result.success).toBe(false);
    });

    it('drops unknown keys from the known view', () =>
    {
        const result = userPreferencesCodec.parse({ rootLabel: 'Docs', theme: 'dark' });

        expect(result).toEqual({ rootLabel: 'Docs' });
    });

    it('accepts both time-format literals', () =>
    {
        expect(userPreferencesCodec.parse({ timeFormat: '12h' }).timeFormat).toBe('12h');
        expect(userPreferencesCodec.parse({ timeFormat: '24h' }).timeFormat).toBe('24h');
    });

    it('rejects a time-format value outside the two literals', () =>
    {
        expect(userPreferencesCodec.safeParse({ timeFormat: '48h' }).success).toBe(false);
    });

    it('trims surrounding whitespace from editorTheme', () =>
    {
        const result = userPreferencesCodec.parse({ editorTheme: '  nord  ' });

        expect(result.editorTheme).toBe('nord');
    });

    it('rejects an editorTheme longer than 64 characters', () =>
    {
        const result = userPreferencesCodec.safeParse({ editorTheme: 'a'.repeat(65) });

        expect(result.success).toBe(false);
    });

    it('rejects an editorTheme that is empty once trimmed', () =>
    {
        const result = userPreferencesCodec.safeParse({ editorTheme: '   ' });

        expect(result.success).toBe(false);
    });

    it('accepts both boolean values for editorGutter', () =>
    {
        expect(userPreferencesCodec.parse({ editorGutter: true }).editorGutter).toBe(true);
        expect(userPreferencesCodec.parse({ editorGutter: false }).editorGutter).toBe(false);
    });

    it('rejects a non-boolean editorGutter', () =>
    {
        expect(userPreferencesCodec.safeParse({ editorGutter: 'on' }).success).toBe(false);
    });

    it('accepts both view-mode literals', () =>
    {
        expect(userPreferencesCodec.parse({ viewMode: 'grid' }).viewMode).toBe('grid');
        expect(userPreferencesCodec.parse({ viewMode: 'list' }).viewMode).toBe('list');
    });

    it('rejects a view-mode value outside the two literals', () =>
    {
        expect(userPreferencesCodec.safeParse({ viewMode: 'compact' }).success).toBe(false);
    });

    it('accepts the three color-mode literals and rejects anything else', () =>
    {
        expect(userPreferencesCodec.parse({ colorMode: 'system' }).colorMode).toBe('system');
        expect(userPreferencesCodec.parse({ colorMode: 'light' }).colorMode).toBe('light');
        expect(userPreferencesCodec.parse({ colorMode: 'dark' }).colorMode).toBe('dark');
        expect(userPreferencesCodec.safeParse({ colorMode: 'midnight' }).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('toUserPreferences', () =>
{
    it('returns the known keys and drops unknown ones from the view', () =>
    {
        const view = toUserPreferences({ rootLabel: 'Docs', theme: 'dark' });

        expect(view).toEqual({ rootLabel: 'Docs' });
    });

    it('collapses a malformed stored value to the empty view instead of throwing', () =>
    {
        const view = toUserPreferences({ rootLabel: 'a'.repeat(65) });

        expect(view).toEqual({});
    });

    it('reads an empty blob as the empty view', () =>
    {
        expect(toUserPreferences({})).toEqual({});
    });

    it('carries a valid time format into the view', () =>
    {
        expect(toUserPreferences({ timeFormat: '24h' })).toEqual({ timeFormat: '24h' });
    });

    it('carries editor theme and gutter preferences into the view', () =>
    {
        expect(toUserPreferences({ editorTheme: 'nord', editorGutter: true }))
            .toEqual({ editorTheme: 'nord', editorGutter: true });
    });

    it('collapses a malformed editor preference to the empty view instead of throwing', () =>
    {
        expect(toUserPreferences({ editorGutter: 'yes' })).toEqual({});
    });

    // A stored preference the read codec does not model is dropped from the view, so a key added to the write side
    // and forgotten here is written and never read back. The type assert beside the codec does not catch that: every
    // field is optional, and it only refuses a MISSING REQUIRED one.
    it('carries the remote-media choice into the view', () =>
    {
        expect(toUserPreferences({ allowRemoteMedia: false })).toEqual({ allowRemoteMedia: false });
        expect(toUserPreferences({ allowRemoteMedia: true })).toEqual({ allowRemoteMedia: true });
    });

    it('collapses a malformed remote-media choice to the empty view instead of throwing', () =>
    {
        expect(toUserPreferences({ allowRemoteMedia: 'no' })).toEqual({});
    });

    it('carries a valid view mode into the view', () =>
    {
        expect(toUserPreferences({ viewMode: 'list' })).toEqual({ viewMode: 'list' });
    });

    it('collapses a malformed view mode to the empty view instead of throwing', () =>
    {
        expect(toUserPreferences({ viewMode: 'compact' })).toEqual({});
    });
});

//----------------------------------------------------------------------------------------------------------------------
