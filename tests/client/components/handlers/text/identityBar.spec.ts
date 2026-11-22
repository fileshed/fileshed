//----------------------------------------------------------------------------------------------------------------------
// Text Identity Bar — the header contribution
//
// The text editor's header chrome: the file name, a save-state readout, and a Read only badge for a viewer. It
// teleports into the layout header, so the real editor store runs and the assertions read the teleported content out of
// the target. What this guards: the name teleports into the target when present, there is no Save button because edits
// save themselves, the readout's Retry after a failed save drives a store save, and a viewer sees a Read only badge.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Support
import { fileNode } from '../../../support.ts';

// Under test
import TextIdentityBar from '@client/components/handlers/text/identityBar.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const HEADER_ID = 'editor-header-center';

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'loading', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :disabled="disabled || loading" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const stubs = {
    UButton: UButtonStub,
    FileActionsMenu: {
        props: [ 'nodeID', 'readOnly' ],
        template: '<div class="file-actions" :data-node="nodeID" :data-read-only="String(readOnly)" />',
    },
    UBadge: {
        name: 'UBadge',
        props: [ 'label', 'icon', 'color', 'variant' ],
        template: '<span class="badge" :data-label="label" />',
    },
    UIcon: { props: [ 'name' ], template: '<i />' },
};

function makeTarget() : void
{
    const el = document.createElement('div');
    el.id = HEADER_ID;
    document.body.appendChild(el);
}

function header() : HTMLElement
{
    const el = document.getElementById(HEADER_ID);
    if(el === null) { throw new Error('header target missing'); }

    return el;
}

async function mountBar(options : { role ?: Role; buffer ?: string } = {}) : Promise<VueWrapper>
{
    const store = useEditorStore();
    store.$patch({
        node: fileNode({ name: 'report.txt', role: options.role ?? 'owner' }),
        buffer: options.buffer ?? '',
    });

    const wrapper = mount(TextIdentityBar, { global: { stubs } });
    await nextTick();

    return wrapper;
}

//----------------------------------------------------------------------------------------------------------------------

describe('TextIdentityBar', () =>
{
    beforeEach(() =>
    {
        vi.restoreAllMocks();
        setActivePinia(createPinia());
        makeTarget();
    });

    afterEach(() => { document.getElementById(HEADER_ID)?.remove(); });

    it('teleports the file name into the header target', async () =>
    {
        await mountBar();

        expect(header().textContent).toContain('report.txt');
    });

    it('has no Save button over unsaved changes, since edits save themselves', async () =>
    {
        await mountBar({ buffer: 'changed' });

        expect(header().querySelector('[data-label="Save"]')).toBeNull();
    });

    it('saves again when Retry is clicked after a failed save', async () =>
    {
        const store = useEditorStore();
        const saveSpy = vi.spyOn(store, 'save').mockResolvedValue();
        await mountBar({ buffer: 'changed' });
        store.$patch({ saveError: 'Network error' });
        await nextTick();

        header().querySelector<HTMLButtonElement>('[data-label="Retry"]')
            ?.click();

        expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('shows a Read only badge for a viewer', async () =>
    {
        await mountBar({ role: 'viewer' });

        expect(header().querySelector('.badge')
            ?.getAttribute('data-label')).toBe('Read only');
    });

    it('puts the file actions menu for the open file beside its name', async () =>
    {
        await mountBar();

        expect(header().querySelector('.file-actions')
            ?.getAttribute('data-node')).toBe('f1');
    });

    it('still gives a viewer the file actions menu, read-only', async () =>
    {
        await mountBar({ role: 'viewer' });

        expect(header().querySelector('.file-actions')
            ?.getAttribute('data-read-only')).toBe('true');
    });
});

//----------------------------------------------------------------------------------------------------------------------
