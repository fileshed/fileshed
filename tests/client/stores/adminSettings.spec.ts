//----------------------------------------------------------------------------------------------------------------------
// Admin Settings Store — server-view adoption
//
// The store's one job: whatever the server answers -- on load, save, or reset -- IS the state. Sources, masked
// values, and the restart flag are never computed client-side, so a save adopts the refreshed view wholesale, and
// a reset is just the null patch. A failed load lands in `error` for the tab's retry state instead of throwing.
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
    };
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
