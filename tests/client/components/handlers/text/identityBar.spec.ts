//----------------------------------------------------------------------------------------------------------------------
// Text Identity Bar — the header contribution
//
// The text editor's header chrome: the file name, a save-state readout, and Save (a Read only badge in its place for a
// viewer). It teleports into the layout header, so the real editor store runs and the assertions read the teleported
// content out of the target. What this guards: the name teleports into the target when present, Save drives a store
// save only over a dirty writable session and is disabled when clean, and a viewer sees a Read only badge.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeResponse, Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Under test
import TextIdentityBar from '@client/components/handlers/text/identityBar.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';
const HEADER_ID = 'editor-header-center';

function fileNode(role : Role = 'owner') : NodeResponse
{
    return {
        id: 'f1',
        name: 'report.txt',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role,
        type: 'file',
        blobID: 'b1',
        size: 10,
        mimeType: 'text/plain',
        trashedAt: null,
    };
}

const UButtonStub = {
    name: 'UButton',
    props: [ 'icon', 'label', 'variant', 'color', 'size', 'loading', 'disabled' ],
    emits: [ 'click' ],
    template: '<button :data-label="label" :disabled="disabled || loading" '
        + '@click="$emit(\'click\')">{{ label }}</button>',
};

const stubs = {
    UButton: UButtonStub,
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
    store.$patch({ node: fileNode(options.role ?? 'owner'), buffer: options.buffer ?? '' });

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

    it('drives a store save when Save is clicked over a dirty writable session', async () =>
    {
        const store = useEditorStore();
        const saveSpy = vi.spyOn(store, 'save').mockResolvedValue();
        await mountBar({ buffer: 'changed' });

        header().querySelector<HTMLButtonElement>('[data-label="Save"]')
            ?.click();

        expect(saveSpy).toHaveBeenCalledTimes(1);
    });

    it('disables Save when the buffer is clean', async () =>
    {
        await mountBar({ buffer: '' });

        expect(header().querySelector('[data-label="Save"]')
            ?.hasAttribute('disabled')).toBe(true);
    });

    it('shows a Read only badge and no Save button for a viewer', async () =>
    {
        await mountBar({ role: 'viewer' });

        expect(header().querySelector('.badge')
            ?.getAttribute('data-label')).toBe('Read only');
        expect(header().querySelector('[data-label="Save"]')).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
