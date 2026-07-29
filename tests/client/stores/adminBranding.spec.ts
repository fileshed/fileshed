//----------------------------------------------------------------------------------------------------------------------
// Admin Branding Store — draft, live preview, and the sparse save
//
// The contract: knob changes land in the draft AND on the document element immediately (the live preview IS the
// feature); Save sends only the keys that differ and adopts the server's merged answer; Revert restores the
// draft and clears every previewed variable -- leftover inline vars would shadow the stylesheet forever.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { defaultInstanceTheme } from '@fileshed/core';

// Resource Access
import { fetchBranding, patchBranding } from '@client/resource-access/admin.ts';

// Under test
import { useAdminBrandingStore } from '@client/stores/adminBranding.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/admin.ts', () => ({
    fetchBranding: vi.fn(),
    patchBranding: vi.fn(),
}));

const fetchMock = fetchBranding as unknown as Mock;
const patchMock = patchBranding as unknown as Mock;

function rootVar(name : string) : string
{
    return document.documentElement.style.getPropertyValue(name);
}

//----------------------------------------------------------------------------------------------------------------------

describe('useAdminBrandingStore', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        document.documentElement.removeAttribute('style');
    });

    it('loads the saved document and starts clean', async () =>
    {
        fetchMock.mockResolvedValue({ ...defaultInstanceTheme, primary: '#3b82f6' });
        const store = useAdminBrandingStore();

        await store.load();

        expect(store.draft.primary).toBe('#3b82f6');
        expect(store.dirty).toBe(false);
    });

    it('paints a knob change onto the document element immediately, lowercasing picker hexes', async () =>
    {
        fetchMock.mockResolvedValue({ ...defaultInstanceTheme });
        const store = useAdminBrandingStore();
        await store.load();

        store.setKnob({ primary: '#3B82F6', radius: 0.5 });

        expect(store.dirty).toBe(true);
        expect(store.draft.primary).toBe('#3b82f6');
        expect(rootVar('--ui-color-primary-500')).toBe('#3b82f6');
        expect(rootVar('--ui-radius')).toBe('0.5rem');
    });

    it('clears a knob\'s variables when it returns to stock', async () =>
    {
        fetchMock.mockResolvedValue({ ...defaultInstanceTheme });
        const store = useAdminBrandingStore();
        await store.load();

        store.setKnob({ radius: 0.5 });
        store.setKnob({ radius: null });

        expect(rootVar('--ui-radius')).toBe('');
    });

    it('saves only the keys that differ and adopts the merged answer', async () =>
    {
        fetchMock.mockResolvedValue({ ...defaultInstanceTheme, primary: '#111111' });
        patchMock.mockResolvedValue({ ...defaultInstanceTheme, primary: '#111111', radius: 0.5 });
        const store = useAdminBrandingStore();
        await store.load();

        store.setKnob({ radius: 0.5 });
        await store.save();

        expect(patchMock).toHaveBeenCalledWith({ radius: 0.5 });
        expect(store.saved.radius).toBe(0.5);
        expect(store.dirty).toBe(false);
        expect(rootVar('--ui-radius')).toBe('');
    });

    it('cache-busts the stylesheet on save and keeps the preview alive until the new sheet lands', async () =>
    {
        const link = document.createElement('link');
        link.setAttribute('href', '/api/branding.css');
        document.head.appendChild(link);

        fetchMock.mockResolvedValue({ ...defaultInstanceTheme });
        patchMock.mockResolvedValue({ ...defaultInstanceTheme, primary: '#3b82f6' });
        const store = useAdminBrandingStore();
        await store.load();

        store.setKnob({ primary: '#3b82f6' });
        await store.save();

        expect(link.getAttribute('href')).toContain('branding.css?v=');

        // Clearing before the new stylesheet loads would flash the app back to stock for a full round trip.
        expect(rootVar('--ui-color-primary-500')).toBe('#3b82f6');

        link.dispatchEvent(new Event('load'));
        expect(rootVar('--ui-color-primary-500')).toBe('');

        link.remove();
    });

    it('reverts the draft and wipes the preview', async () =>
    {
        fetchMock.mockResolvedValue({ ...defaultInstanceTheme });
        const store = useAdminBrandingStore();
        await store.load();

        store.setKnob({ primary: '#3b82f6', neutral: 'slate' });
        store.revert();

        expect(store.dirty).toBe(false);
        expect(store.draft.primary).toBeNull();
        expect(rootVar('--ui-color-primary-500')).toBe('');
        expect(rootVar('--ui-color-neutral-500')).toBe('');
    });
});

//----------------------------------------------------------------------------------------------------------------------
