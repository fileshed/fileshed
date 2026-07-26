//----------------------------------------------------------------------------------------------------------------------
// Markdown Identity Bar — the header contribution
//
// The markdown family's header chrome: the file name, a save-state readout, the Preview/Source toggle, and Save (a Read
// only badge in its place for a viewer). It teleports into the layout header's center region, so the real store runs
// and the assertions read the teleported content out of the target. What this guards: the identity teleports into the
// target when present and stays out of the void when absent, the toggle emits the target view, Save drives a store save
// only over a dirty writable session and is disabled when clean, and a viewer sees a Read only badge in place of Save.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeResponse, Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Under test
import MarkdownIdentityBar from '@client/components/handlers/markdown/identityBar.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';
const HEADER_ID = 'editor-header-center';

function fileNode(role : Role = 'owner') : NodeResponse
{
    return {
        id: 'f1',
        name: 'notes.md',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role,
        type: 'file',
        blobID: 'b1',
        size: 10,
        mimeType: 'text/markdown',
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
    UFieldGroup: { template: '<div><slot /></div>' },
    UBadge: {
        name: 'UBadge',
        props: [ 'label', 'icon', 'color', 'variant' ],
        template: '<span class="badge" :data-label="label" />',
    },
    UIcon: { props: [ 'name' ], template: '<i />' },
};

function makeTarget() : HTMLElement
{
    const el = document.createElement('div');
    el.id = HEADER_ID;
    document.body.appendChild(el);

    return el;
}

function header() : HTMLElement
{
    const el = document.getElementById(HEADER_ID);
    if(el === null) { throw new Error('header target missing'); }

    return el;
}

// A writable owner session unless a lesser role is asked for; the buffer sets dirtiness against the store's saved text
// (empty on a fresh store), so an empty buffer is clean and any other buffer is dirty. The header target is resolved on
// mount, so the teleport only lands after the following tick -- awaited here so callers read a settled header.
async function mountBar(
    options : { view ?: 'wysiwyg' | 'source'; role ?: Role; buffer ?: string } = {}
) : Promise<VueWrapper>
{
    const store = useEditorStore();
    store.$patch({ node: fileNode(options.role ?? 'owner'), buffer: options.buffer ?? '' });

    const wrapper = mount(MarkdownIdentityBar, {
        props: { view: options.view ?? 'wysiwyg' },
        global: { stubs },
    });
    await nextTick();

    return wrapper;
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownIdentityBar teleport', () =>
{
    beforeEach(() =>
    {
        vi.restoreAllMocks();
        setActivePinia(createPinia());
    });

    afterEach(() => { document.getElementById(HEADER_ID)?.remove(); });

    it('teleports its identity into the header target when it is present', async () =>
    {
        makeTarget();

        await mountBar();

        expect(header().textContent).toContain('notes.md');
    });

    it('renders nothing when the header target is absent', async () =>
    {
        const wrapper = await mountBar();

        expect(document.getElementById(HEADER_ID)).toBeNull();
        expect(wrapper.find('[data-label="Save"]').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownIdentityBar view toggle', () =>
{
    beforeEach(() =>
    {
        vi.restoreAllMocks();
        setActivePinia(createPinia());
        makeTarget();
    });

    afterEach(() => { document.getElementById(HEADER_ID)?.remove(); });

    it('emits the source view when Source is clicked', async () =>
    {
        const wrapper = await mountBar({ view: 'wysiwyg' });

        header().querySelector<HTMLButtonElement>('[data-label="Source"]')
            ?.click();
        await nextTick();

        expect(wrapper.emitted('update:view')).toEqual([ [ 'source' ] ]);
    });

    it('emits the wysiwyg view when Preview is clicked', async () =>
    {
        const wrapper = await mountBar({ view: 'source' });

        header().querySelector<HTMLButtonElement>('[data-label="Preview"]')
            ?.click();
        await nextTick();

        expect(wrapper.emitted('update:view')).toEqual([ [ 'wysiwyg' ] ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownIdentityBar save', () =>
{
    beforeEach(() =>
    {
        vi.restoreAllMocks();
        setActivePinia(createPinia());
        makeTarget();
    });

    afterEach(() => { document.getElementById(HEADER_ID)?.remove(); });

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
