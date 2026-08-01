//----------------------------------------------------------------------------------------------------------------------
// App Store
//
// The instance's public identity, loaded once from the anonymous handshake: the display name every wordmark and
// title reads, the color-mode policy the root component applies, and the size caps the pickers enforce. A failed
// load keeps the stock identity -- the app must render even when the first request dies.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    DEFAULT_AVATAR_MAX_BYTES,
    DEFAULT_UPLOAD_MAX_BYTES,
    type InstanceBranding,
    type InstanceLimits,
} from '@fileshed/core';

// Resource Access
import { fetchInstance } from '../resource-access/instance.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useAppStore = defineStore('app', () =>
{
    const branding = ref<InstanceBranding | null>(null);
    const limits = ref<InstanceLimits | null>(null);
    const tagline = ref('Self-hosted, multi-user file hosting.');

    const name = computed(() => branding.value?.instanceName ?? 'FileShed');
    const forcedMode = computed(() => branding.value?.forcedMode ?? false);

    // The mark every sidebar and the favicon show: the uploaded logo when set (hash-busted, so replacing it
    // never fights a cache), the stock mark otherwise.
    const logoUrl = computed(() =>
    {
        const logo = branding.value?.logo;

        return typeof logo === 'string' && logo !== '' ? `/api/branding/logo?v=${ logo }` : '/fileshed.svg';
    });

    // The caps a picker has to respect but cannot guess. The shipped defaults stand in only until the handshake
    // lands -- a deployment that moved a cap is described by the server, never by whatever this bundle was built
    // against.
    const uploadMaxBytes = computed(() => limits.value?.uploadMaxBytes ?? DEFAULT_UPLOAD_MAX_BYTES);
    const avatarMaxBytes = computed(() => limits.value?.avatarMaxBytes ?? DEFAULT_AVATAR_MAX_BYTES);

    async function initialize() : Promise<void>
    {
        try
        {
            const instance = await fetchInstance();

            branding.value = instance.branding;
            limits.value = instance.limits;
        }
        catch(error)
        {
            console.error('Instance handshake failed', error);
        }
    }

    return {
        branding,
        limits,
        name,
        tagline,
        forcedMode,
        logoUrl,
        uploadMaxBytes,
        avatarMaxBytes,
        initialize,
    };
});

//----------------------------------------------------------------------------------------------------------------------
