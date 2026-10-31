//----------------------------------------------------------------------------------------------------------------------
// App Store
//
// A failed load keeps the stock identity, since the app must render even when the first request fails.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    DEFAULT_AVATAR_MAX_BYTES,
    DEFAULT_INSTANCE_NAME,
    DEFAULT_UPLOAD_MAX_BYTES,
    type InstanceBranding,
    type InstanceLimits,
} from '@fileshed/core';

// Resource Access
import { getInstance } from '../resource-access/instance.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useAppStore = defineStore('app', () =>
{
    const branding = ref<InstanceBranding | null>(null);
    const limits = ref<InstanceLimits | null>(null);
    const tagline = ref('Self-hosted, multi-user file hosting.');

    const name = computed(() => branding.value?.instanceName ?? DEFAULT_INSTANCE_NAME);
    const forcedMode = computed(() => branding.value?.forcedMode ?? false);

    // The mark every sidebar and the favicon show: the uploaded logo when set (hash-busted, so replacing it
    // never fights a cache), the stock mark otherwise.
    const logoURL = computed(() =>
    {
        const logo = branding.value?.logo;

        return typeof logo === 'string' && logo !== '' ? `/api/branding/logo?v=${ logo }` : '/fileshed.svg';
    });

    // The caps a picker has to respect but cannot guess. The shipped defaults stand in only until the handshake
    // lands -- a deployment that moved a cap is described by the server, never by whatever this bundle was built
    // against.
    const uploadMaxBytes = computed(() => limits.value?.uploadMaxBytes ?? DEFAULT_UPLOAD_MAX_BYTES);

    // The junk list this instance refuses. Empty until the handshake answers, which is the right default: skipping
    // nothing is the behaviour a client that has not been told the rule should have.
    const skippedUploadNames = computed(() => limits.value?.skippedUploadNames ?? []);
    const avatarMaxBytes = computed(() => limits.value?.avatarMaxBytes ?? DEFAULT_AVATAR_MAX_BYTES);

    async function init() : Promise<void>
    {
        try
        {
            const instance = await getInstance();

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
        logoURL,
        uploadMaxBytes,
        skippedUploadNames,
        avatarMaxBytes,
        init,
    };
});

//----------------------------------------------------------------------------------------------------------------------
