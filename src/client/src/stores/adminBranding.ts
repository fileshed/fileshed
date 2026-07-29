//----------------------------------------------------------------------------------------------------------------------
// Admin Branding Store
//
// The Branding tab's draft brain: `saved` is the server's document, `draft` is what the knobs edit, and every
// knob change repaints the app immediately through the preview variables. Save sends ONLY the keys that differ
// and adopts the merged document the server answers; Revert restores the draft and wipes the preview. Custom CSS
// deliberately never previews -- a half-typed selector must not wreck the admin mid-keystroke; it applies
// through the stylesheet after Save, which is also why Save cache-busts the branding.css link.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    type InstanceTheme,
    type UpdateBrandingRequest,
    buildThemeVariables,
    defaultInstanceTheme,
} from '@fileshed/core';

// Stores
import { useAppStore } from './app.ts';

// Resource Access
import { fetchBranding, patchBranding } from '../resource-access/admin.ts';

// Utils
import { applyThemePreview, clearThemePreview } from '../utils/themePreview.ts';

//----------------------------------------------------------------------------------------------------------------------

const themeKeys = Object.keys(defaultInstanceTheme) as (keyof InstanceTheme)[];

// Hex values arrive in whatever case the picker emits; lowercasing them here keeps the dirty diff honest against
// the server's stored form, which the codec lowercases too.
function normalizeKnobValue(key : string, value : unknown) : unknown
{
    if((key === 'primary' || key === 'secondary') && typeof value === 'string') { return value.toLowerCase(); }

    return value;
}

// onSettled fires once the swapped stylesheet lands (or fails) -- the preview variables must outlive the fetch,
// or the app flashes back to stock for a round trip after every save.
function refreshStylesheet(onSettled : () => void) : void
{
    const link = document.querySelector<HTMLLinkElement>('link[href*="branding.css"]');
    if(link === null) { onSettled(); return; }

    const url = new URL(link.href, window.location.origin);
    url.searchParams.set('v', String(Date.now()));
    link.addEventListener('load', () => onSettled(), { once: true });
    link.addEventListener('error', () => onSettled(), { once: true });
    link.href = url.pathname + url.search;
}

//----------------------------------------------------------------------------------------------------------------------

export const useAdminBrandingStore = defineStore('adminBranding', () =>
{
    const saved = ref<InstanceTheme>({ ...defaultInstanceTheme });
    const draft = ref<InstanceTheme>({ ...defaultInstanceTheme });
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const dirty = computed(() => themeKeys.some((key) => draft.value[key] !== saved.value[key]));

    async function load() : Promise<void>
    {
        loading.value = true;
        error.value = null;

        try
        {
            saved.value = await fetchBranding();
            draft.value = { ...saved.value };
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

    function setKnob(patch : UpdateBrandingRequest) : void
    {
        const normalized = Object.fromEntries(Object.entries(patch)
            .map(([ key, value ]) => [ key, normalizeKnobValue(key, value) ]));

        draft.value = { ...draft.value, ...normalized };
        applyThemePreview(buildThemeVariables(draft.value));
    }

    async function save() : Promise<void>
    {
        const changes = Object.fromEntries(themeKeys
            .filter((key) => draft.value[key] !== saved.value[key])
            .map((key) => [ key, draft.value[key] ]));

        saved.value = await patchBranding(changes);
        draft.value = { ...saved.value };

        refreshStylesheet(() => clearThemePreview());

        // The instance facts changed too (mode policy at minimum) -- refresh them so the admin's own session
        // re-resolves immediately instead of waiting for the next page load.
        void useAppStore().initialize();
    }

    function revert() : void
    {
        draft.value = { ...saved.value };
        clearThemePreview();
    }

    return { saved, draft, loading, error, dirty, load, setKnob, save, revert };
});

//----------------------------------------------------------------------------------------------------------------------
