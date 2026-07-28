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
    }

    async function save(key : AdminSettingKey, value : SettingValue) : Promise<void>
    {
        await apply({ [key]: value });
    }

    async function reset(key : AdminSettingKey) : Promise<void>
    {
        await apply({ [key]: null });
    }

    return { entries, restartRequired, loading, error, load, save, reset };
});

//----------------------------------------------------------------------------------------------------------------------
