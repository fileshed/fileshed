//----------------------------------------------------------------------------------------------------------------------
// Admin Settings Store — server-view adoption
//
// The store's one job: whatever the server answers -- on load, save, or reset -- IS the state. Sources, masked
// values, and the restart flag are never computed client-side, so a save adopts the refreshed view wholesale, and
// a reset is just the null patch. A failed load lands in `error` for the tab's retry state instead of throwing.
// Readers that only want a value back off the view ask through ensureLoaded, which spends a round trip only when
// the store has nothing to read.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { AdminSettingEntry, AdminSettingsResponse } from '@fileshed/core';

// Resource Access
import { fetchAdminSettings, patchAdminSettings } from '@client/resource-access/admin.ts';

// Under test
import { useAdminSettingsStore } from '@client/stores/adminSettings.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    fetchAdminSettings: vi.fn(),
    patchAdminSettings: vi.fn(),
}));

const fetchMock = fetchAdminSettings as unknown as Mock;
const patchMock = patchAdminSettings as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

function entry(overrides : Partial<AdminSettingEntry> = {}) : AdminSettingEntry
{
    return {
        key: 'SIGN_UP_ENABLED',
        kind: 'boolean',
        secret: false,
        requiresRestart: false,
        value: true,
        source: 'default',
        ...overrides,
        hasDefault: overrides.hasDefault ?? true,
    };
}

function quotaEntry(bytes : number) : AdminSettingEntry
{
    return entry({ key: 'DEFAULT_QUOTA_BYTES', kind: 'number', value: bytes });
}

function view(entries : AdminSettingEntry[], restartRequired = false) : AdminSettingsResponse
{
    return { settings: entries, restartRequired };
}

//----------------------------------------------------------------------------------------------------------------------

describe('useAdminSettingsStore', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    it('adopts the server view on load', async () =>
    {
        fetchMock.mockResolvedValue(view([ entry() ], true));
        const store = useAdminSettingsStore();

        await store.load();

        expect(store.entries).toHaveLength(1);
        expect(store.restartRequired).toBe(true);
        expect(store.error).toBeNull();
    });

    it('lands a failed load in error instead of throwing', async () =>
    {
        fetchMock.mockRejectedValue(new Error('offline'));
        const store = useAdminSettingsStore();

        await store.load();

        expect(store.error?.message).toBe('offline');
        expect(store.entries).toHaveLength(0);
    });

    it('ensureLoaded fetches the view when the store has none', async () =>
    {
        fetchMock.mockResolvedValue(view([ quotaEntry(20_000) ]));
        const store = useAdminSettingsStore();

        await store.ensureLoaded();

        expect(store.defaultQuota).toBe(20_000);
    });

    it('ensureLoaded answers from the view already in hand instead of asking again', async () =>
    {
        fetchMock.mockResolvedValue(view([ quotaEntry(20_000) ]));
        const store = useAdminSettingsStore();
        await store.load();
        fetchMock.mockClear();

        await store.ensureLoaded();

        expect(store.defaultQuota).toBe(20_000);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // A blip that leaves the store empty must not blank the values every later reader depends on.
    it('ensureLoaded asks again after a load that failed', async () =>
    {
        fetchMock.mockRejectedValueOnce(new Error('offline'));
        const store = useAdminSettingsStore();
        await store.load();

        fetchMock.mockResolvedValue(view([ quotaEntry(20_000) ]));
        await store.ensureLoaded();

        expect(store.defaultQuota).toBe(20_000);
        expect(store.error).toBeNull();
    });

    it('save patches the one key and adopts the refreshed view', async () =>
    {
        patchMock.mockResolvedValue(view([ entry({ value: false, source: 'override' }) ]));
        const store = useAdminSettingsStore();

        await store.save('SIGN_UP_ENABLED', false);

        expect(patchMock).toHaveBeenCalledWith({ SIGN_UP_ENABLED: false });
        expect(store.entries[0]).toMatchObject({ value: false, source: 'override' });
    });

    it('reset is the null patch, and the key returns to its default', async () =>
    {
        patchMock.mockResolvedValue(view([ entry({ value: true, source: 'default' }) ]));
        const store = useAdminSettingsStore();

        await store.reset('SIGN_UP_ENABLED');

        expect(patchMock).toHaveBeenCalledWith({ SIGN_UP_ENABLED: null });
        expect(store.entries[0]).toMatchObject({ value: true, source: 'default' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
