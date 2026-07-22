//----------------------------------------------------------------------------------------------------------------------
// Me DTO -- the quota shape, the unlimited (null) case, and the preferences blob
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { meResponseCodec, updatePreferencesRequestCodec } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('meResponseCodec', () =>
{
    const base = {
        id: 'user_1',
        email: 'ada@example.com',
        role: 'user' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
    };

    // quotaLimit is null for an unlimited account -- the wire shape must admit that, not force a numeric sentinel.
    it('accepts a null quota limit for an unlimited account', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 4096, limit: null } });

        expect(result.success).toBe(true);
    });

    // a 0 limit is a valid block-all quota (the regulation engine admits only zero-byte writes
    // against it), distinct from null. The wire shape must accept it rather than rejecting it as non-positive.
    it('accepts a zero quota limit as a real block-all limit', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 0, limit: 0 } });

        expect(result.success).toBe(true);
    });

    it('rejects a negative used value', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: -1, limit: null } });

        expect(result.success).toBe(false);
    });

    it('rejects a negative quota limit', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 0, limit: -1 } });

        expect(result.success).toBe(false);
    });

    // Preferences are wire-loose input, invariant output: a response that omits the blob parses to an empty one rather
    // than failing, so an older server missing the field still reads.
    it('defaults preferences to an empty blob when the response omits it', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 0, limit: null } });

        expect(result.success).toBe(true);
        expect(result.success && result.data.preferences).toEqual({});
    });

    it('carries a rootLabel preference through', () =>
    {
        const result = meResponseCodec.safeParse({
            ...base,
            quota: { used: 0, limit: null },
            preferences: { rootLabel: 'Photos' },
        });

        expect(result.success && result.data.preferences.rootLabel).toBe('Photos');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('updatePreferencesRequestCodec', () =>
{
    it('trims a rootLabel patch', () =>
    {
        const result = updatePreferencesRequestCodec.parse({ rootLabel: '  Work  ' });

        expect(result.rootLabel).toBe('Work');
    });

    it('rejects a rootLabel longer than 64 characters', () =>
    {
        const result = updatePreferencesRequestCodec.safeParse({ rootLabel: 'a'.repeat(65) });

        expect(result.success).toBe(false);
    });

    it('rejects a rootLabel that is empty once trimmed', () =>
    {
        const result = updatePreferencesRequestCodec.safeParse({ rootLabel: '   ' });

        expect(result.success).toBe(false);
    });

    // null is the delete signal -- the wire shape must admit it, distinct from an absent key (no change).
    it('accepts a null rootLabel as the delete signal', () =>
    {
        const result = updatePreferencesRequestCodec.safeParse({ rootLabel: null });

        expect(result.success).toBe(true);
        expect(result.success && result.data.rootLabel).toBeNull();
    });

    it('accepts an empty patch', () =>
    {
        const result = updatePreferencesRequestCodec.safeParse({});

        expect(result.success).toBe(true);
    });

    // The whole point of the loose codec: a preference this version does not model must pass through untouched, so a
    // newer client's write is never stripped by an older one.
    it('passes unknown keys through the patch untouched', () =>
    {
        const result = updatePreferencesRequestCodec.parse({ rootLabel: 'Work', theme: 'dark' });

        expect(result).toEqual({ rootLabel: 'Work', theme: 'dark' });
    });

    it('accepts both time-format literals and a null delete', () =>
    {
        expect(updatePreferencesRequestCodec.parse({ timeFormat: '12h' }).timeFormat).toBe('12h');
        expect(updatePreferencesRequestCodec.parse({ timeFormat: '24h' }).timeFormat).toBe('24h');
        expect(updatePreferencesRequestCodec.parse({ timeFormat: null }).timeFormat).toBeNull();
    });

    it('rejects a time-format value outside the two literals', () =>
    {
        expect(updatePreferencesRequestCodec.safeParse({ timeFormat: 'military' }).success).toBe(false);
    });

    it('trims an editorTheme patch', () =>
    {
        const result = updatePreferencesRequestCodec.parse({ editorTheme: '  ayu-dark  ' });

        expect(result.editorTheme).toBe('ayu-dark');
    });

    it('rejects an editorTheme longer than 64 characters', () =>
    {
        const result = updatePreferencesRequestCodec.safeParse({ editorTheme: 'a'.repeat(65) });

        expect(result.success).toBe(false);
    });

    it('accepts a null editorTheme as the delete signal', () =>
    {
        const result = updatePreferencesRequestCodec.safeParse({ editorTheme: null });

        expect(result.success).toBe(true);
        expect(result.success && result.data.editorTheme).toBeNull();
    });

    it('accepts a boolean editorGutter and a null delete', () =>
    {
        expect(updatePreferencesRequestCodec.parse({ editorGutter: true }).editorGutter).toBe(true);
        expect(updatePreferencesRequestCodec.parse({ editorGutter: false }).editorGutter).toBe(false);
        expect(updatePreferencesRequestCodec.parse({ editorGutter: null }).editorGutter).toBeNull();
    });

    it('rejects a non-boolean editorGutter', () =>
    {
        expect(updatePreferencesRequestCodec.safeParse({ editorGutter: 1 }).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
