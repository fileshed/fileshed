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
        limits: { trashRetentionDays: 30 },
        createdAt: '2026-01-01T00:00:00.000Z',
    };

    // A limit of null is an account inheriting the instance default, so the wire shape must admit it rather than
    // forcing a numeric sentinel -- and an effective of null is the resolved answer "no cap at all".
    it('accepts a null quota limit for an account inheriting the instance default', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 4096, effective: null, limit: null } });

        expect(result.success).toBe(true);
    });

    // 0 is the per-user way to say "unlimited, whatever the default becomes", so it must survive the wire as itself
    // rather than being rejected as non-positive or flattened into null.
    it('accepts a zero quota limit as an explicit per-user unlimited', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 0, effective: null, limit: 0 } });

        expect(result.success).toBe(true);
    });

    // Unlimited is spelled null on the effective side and nowhere else. A 0 there would be a resolution bug leaking
    // the raw sentinel, and a client reading it as a cap would report an account that can store nothing.
    it('rejects a zero effective quota, which would be the unlimited sentinel left unresolved', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 0, effective: 0, limit: 0 } });

        expect(result.success).toBe(false);
    });

    it('rejects a negative used value', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: -1, effective: null, limit: null } });

        expect(result.success).toBe(false);
    });

    it('rejects a negative quota limit', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 0, effective: null, limit: -1 } });

        expect(result.success).toBe(false);
    });

    // Retention copy is built from this value, so a profile without it is not a valid profile -- the server always
    // knows its configuration and must always send it.
    it('rejects a profile missing the limits object', () =>
    {
        const { limits: _limits, ...withoutLimits } = { ...base, quota: { used: 0, effective: null, limit: null } };
        const result = meResponseCodec.safeParse(withoutLimits);

        expect(result.success).toBe(false);
    });

    // Preferences are wire-loose input, invariant output: a response that omits the blob parses to an empty one rather
    // than failing, so an older server missing the field still reads.
    it('defaults preferences to an empty blob when the response omits it', () =>
    {
        const result = meResponseCodec.safeParse({ ...base, quota: { used: 0, effective: null, limit: null } });

        expect(result.success).toBe(true);
        expect(result.success && result.data.preferences).toEqual({});
    });

    it('carries a rootLabel preference through', () =>
    {
        const result = meResponseCodec.safeParse({
            ...base,
            quota: { used: 0, effective: null, limit: null },
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

    it('accepts a boolean allowRemoteMedia and a null delete, rejecting anything else', () =>
    {
        expect(updatePreferencesRequestCodec.parse({ allowRemoteMedia: false }).allowRemoteMedia).toBe(false);
        expect(updatePreferencesRequestCodec.parse({ allowRemoteMedia: true }).allowRemoteMedia).toBe(true);
        expect(updatePreferencesRequestCodec.parse({ allowRemoteMedia: null }).allowRemoteMedia).toBeNull();
        expect(updatePreferencesRequestCodec.safeParse({ allowRemoteMedia: 'yes' }).success).toBe(false);
    });

    // A colorMode outside the three literals must die HERE: the read side collapses the whole blob to empty on
    // any invalid known value, so an unvalidated write would wipe every preference the user has.
    it('accepts the three color-mode literals and a null delete, rejecting anything else', () =>
    {
        expect(updatePreferencesRequestCodec.parse({ colorMode: 'system' }).colorMode).toBe('system');
        expect(updatePreferencesRequestCodec.parse({ colorMode: 'light' }).colorMode).toBe('light');
        expect(updatePreferencesRequestCodec.parse({ colorMode: 'dark' }).colorMode).toBe('dark');
        expect(updatePreferencesRequestCodec.parse({ colorMode: null }).colorMode).toBeNull();
        expect(updatePreferencesRequestCodec.safeParse({ colorMode: 'neon-nightmare' }).success).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
