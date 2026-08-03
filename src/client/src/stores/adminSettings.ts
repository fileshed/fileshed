//----------------------------------------------------------------------------------------------------------------------
// Admin Settings Store
//
// State behind the admin Settings tab and the restart banner: the vocabulary entries with their effective values,
// and the restartRequired flag both the Settings and Status tabs read. Every mutation adopts the server's refreshed
// view wholesale -- sources, masked secrets, and the restart flag stay whatever the server says they are, never a
// client-side guess. Mutation errors propagate to the caller to toast; a failed load lands in `error` for the
// tab's retry state.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    type AdminSettingEntry,
    type AdminSettingKey,
    type PatchSettingsRequest,
    type SettingValue,
    UNLIMITED_QUOTA,
} from '@fileshed/core';

// Stores
import { useAppStore } from './app.ts';

// Resource Access
import { fetchAdminSettings, patchAdminSettings } from '../resource-access/admin.ts';

//----------------------------------------------------------------------------------------------------------------------

// The settings keys the anonymous handshake carries, and so the ones whose change has to reach surfaces outside this
// tab: the instance name brands every wordmark and title, the size caps gate the pickers. Moving one should move the
// admin's own session now, not on the next reload.
const handshakeKeys : readonly AdminSettingKey[] = [ 'INSTANCE_NAME', 'UPLOAD_MAX_BYTES', 'AVATAR_MAX_BYTES' ];

//----------------------------------------------------------------------------------------------------------------------

export const useAdminSettingsStore = defineStore('adminSettings', () =>
{
    const entries = ref<AdminSettingEntry[]>([]);
    const restartRequired = ref(false);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    // The quota an account with no limit of its own inherits, in the same 0-is-unlimited dialect the per-user
    // column speaks. Unlimited until the entries load, which is also what ships.
    const defaultQuota = computed(() =>
    {
        const value = entries.value.find((entry) => entry.key === 'DEFAULT_QUOTA_BYTES')?.value;

        return typeof value === 'number' ? value : UNLIMITED_QUOTA;
    });

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

    // A non-empty entries array is a server view already in hand: the vocabulary is a fixed list, so a load that
    // landed left every key in it. For a surface that only reads a value back off the entries, that view is enough.
    async function ensureLoaded() : Promise<void>
    {
        if(entries.value.length > 0) { return; }

        await load();
    }

    async function apply(changes : PatchSettingsRequest['changes']) : Promise<void>
    {
        adopt(await patchAdminSettings(changes));

        if(handshakeKeys.some((key) => key in changes)) { void useAppStore().initialize(); }
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

    return { entries, restartRequired, loading, error, defaultQuota, load, ensureLoaded, save, reset, resetAll };
});

//----------------------------------------------------------------------------------------------------------------------
