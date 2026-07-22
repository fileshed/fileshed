//----------------------------------------------------------------------------------------------------------------------
// Preferences Engine — key-wise patch merge
//
// applyPreferencesPatch merges a patch into the stored blob: a concrete value sets a key, null deletes it, an absent
// key is left alone. The guarantee that matters is that every key the patch does not mention survives -- that is how a
// preference a newer client wrote outlives an older client's write. Pure logic, tested with real data and no mocks.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { applyPreferencesPatch } from '@server/engines/preferences.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('applyPreferencesPatch', () =>
{
    it('sets a key from the patch value', () =>
    {
        const merged = applyPreferencesPatch({}, { rootLabel: 'Work' });

        expect(merged).toEqual({ rootLabel: 'Work' });
    });

    it('overwrites an existing key', () =>
    {
        const merged = applyPreferencesPatch({ rootLabel: 'Old' }, { rootLabel: 'New' });

        expect(merged).toEqual({ rootLabel: 'New' });
    });

    it('deletes a key set to null', () =>
    {
        const merged = applyPreferencesPatch({ rootLabel: 'Work' }, { rootLabel: null });

        expect(merged).toEqual({});
    });

    it('leaves a key the patch does not mention untouched', () =>
    {
        const merged = applyPreferencesPatch({ rootLabel: 'Work' }, {});

        expect(merged).toEqual({ rootLabel: 'Work' });
    });

    // The forward-compat guarantee: a stored key this version does not model survives a patch that changes a known one.
    it('preserves an unknown stored key across a patch of a known key', () =>
    {
        const merged = applyPreferencesPatch({ theme: 'dark' }, { rootLabel: 'Work' });

        expect(merged).toEqual({ theme: 'dark', rootLabel: 'Work' });
    });

    it('stores an unknown key carried by the patch', () =>
    {
        const merged = applyPreferencesPatch({}, { rootLabel: 'Work', theme: 'dark' });

        expect(merged).toEqual({ rootLabel: 'Work', theme: 'dark' });
    });

    it('does not mutate the stored blob it was handed', () =>
    {
        const stored = { rootLabel: 'Work' };

        applyPreferencesPatch(stored, { rootLabel: 'New' });

        expect(stored).toEqual({ rootLabel: 'Work' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
