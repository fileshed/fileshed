//----------------------------------------------------------------------------------------------------------------------
// App Store
//
// The instance's public identity, loaded once from the anonymous handshake: the display name every wordmark and
// title reads, and the color-mode policy the root component applies. A failed load keeps the stock identity --
// the app must render even when the first request dies.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import type { InstanceBranding } from '@fileshed/core';

// Resource Access
import { fetchInstance } from '../resource-access/instance.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useAppStore = defineStore('app', () =>
{
    const branding = ref<InstanceBranding | null>(null);
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

    async function initialize() : Promise<void>
    {
        try
        {
            branding.value = (await fetchInstance()).branding;
        }
        catch(error)
        {
            console.error('Instance handshake failed', error);
        }
    }

    return { branding, name, tagline, forcedMode, logoUrl, initialize };
});

//----------------------------------------------------------------------------------------------------------------------
