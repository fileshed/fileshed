//----------------------------------------------------------------------------------------------------------------------
// Admin Settings Store
//
// State behind the admin Settings tab and the restart banner: the vocabulary entries with their effective values,
// and the restartRequired flag both the Settings and Status tabs read. Every mutation adopts the server's refreshed
// view wholesale -- sources, masked secrets, and the restart flag stay whatever the server says they are, never a
// client-side guess. Mutation errors propagate to the caller to toast; a failed load lands in `error` for the
// tab's retry state.
//----------------------------------------------------------------------------------------------------------------------

import { ref } from 'vue';
import { defineStore } from 'pinia';

import type { AdminSettingEntry, AdminSettingKey, PatchSettingsRequest, SettingValue } from '@fileshed/core';

// Stores
import { useAppStore } from './app.ts';

// Resource Access
import { fetchAdminSettings, patchAdminSettings } from '../resource-access/admin.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useAdminSettingsStore = defineStore('adminSettings', () =>
{
    const entries = ref<AdminSettingEntry[]>([]);
    const restartRequired = ref(false);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    function adopt(view : { settings : AdminSettingEntry[]; restartRequired : boolean }) : void
    {
        entries.value = view.settings;
        restartRequired.value = view.restartRequired;
    }

    async function load() : Promise<void>
    {
        loading.value = true;
        error.value = null;

        try
        {
            adopt(await fetchAdminSettings());
        }
        catch(caught)
        {
            error.value = caught instanceof Error ? caught : new Error(String(caught));
        }
        finally
        {
            loading.value = false;
        }
    }

    async function apply(changes : PatchSettingsRequest['changes']) : Promise<void>
    {
        adopt(await patchAdminSettings(changes));

        // The one settings key with pre-auth surfaces: renaming the instance should rename the wordmark and
        // title the admin is looking at, not wait for a reload.
        if('INSTANCE_NAME' in changes) { void useAppStore().initialize(); }
    }

    async function save(key : AdminSettingKey, value : SettingValue) : Promise<void>
    {
        await apply({ [key]: value });
    }

    async function reset(key : AdminSettingKey) : Promise<void>
    {
        await apply({ [key]: null });
    }

    // One PATCH, so a multi-key removal lands atomically instead of racing refreshed views.
    async function resetAll(keys : readonly AdminSettingKey[]) : Promise<void>
    {
        await apply(Object.fromEntries(keys.map((key) => [ key, null ])));
    }

    return { entries, restartRequired, loading, error, load, save, reset, resetAll };
});

//----------------------------------------------------------------------------------------------------------------------
