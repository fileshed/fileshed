//----------------------------------------------------------------------------------------------------------------------
// Markdown Identity Bar — the header contribution
//
// The markdown family's header chrome: the file name, a save-state readout, the Preview/Source toggle, and a Read only
// badge for a viewer. It teleports into the layout header's center region, so the real store runs and the assertions
// read the teleported content out of the target. What this guards: the identity teleports into the target when present
// and stays out of the void when absent, the toggle emits the target view, there is no Save button because edits save
// themselves, the readout's Retry after a failed save drives a store save, a viewer sees a Read only badge, a
// frontmatter title stands in for the file name -- in the header and the browser tab -- and edits as the title property
// rather than renaming the file, and the file actions menu carries a properties entry that fits the frontmatter.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { Role } from '@fileshed/core';

// Stores
import { useAppStore } from '@client/stores/app.ts';
import { useEditorStore } from '@client/stores/editor.ts';

// Support
import { fileNode } from '../../../support.ts';

// Under test
import MarkdownIdentityBar from '@client/components/handlers/markdown/identityBar.vue';

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

const openModal = vi.fn();

const stubs = {
    UButton: UButtonStub,
    FileActionsMenu: {
        props: [ 'nodeID', 'items' ],
        template: '<div class="file-actions" :data-node="nodeID">'
            + '<button v-for="item in items" :key="item.label" class="menu-item" :data-color="item.color" '
            + '@click="item.onSelect()">{{ item.label }}</button></div>',
    },
    EditPropertiesModal: defineComponent({
        setup(_, { expose })
        {
            expose({ open: openModal });
            return () => h('div');
        },
    }),
    UFieldGroup: { template: '<div><slot /></div>' },
    UTooltip: { template: '<slot />' },
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
    store.$patch({
        node: fileNode({ name: 'notes.md', role: options.role ?? 'owner' }),
        buffer: options.buffer ?? '',
    });

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
        expect(wrapper.find('[data-label="Source"]').exists()).toBe(false);
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
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownIdentityBar properties entry', () =>
{
    beforeEach(() =>
    {
        vi.restoreAllMocks();
        setActivePinia(createPinia());
        makeTarget();
        openModal.mockClear();
    });

    afterEach(() => { document.getElementById(HEADER_ID)?.remove(); });

    function menuLabels() : string[]
    {
        return [ ...header().querySelectorAll('.menu-item') ].map((el) => el.textContent?.trim() ?? '');
    }

    it('offers to edit the properties of a file with frontmatter, and opens the modal for it', async () =>
    {
        await mountBar({ buffer: '---\ntitle: x\n---\n\nBody' });

        expect(menuLabels()).toEqual([ 'Edit properties' ]);

        header().querySelector<HTMLButtonElement>('.menu-item')
            ?.click();

        expect(openModal).toHaveBeenCalledTimes(1);
    });

    it('offers to add properties to a file without frontmatter', async () =>
    {
        await mountBar({ buffer: '# Body' });

        expect(menuLabels()).toEqual([ 'Add properties' ]);
    });

    it('offers a viewer the properties to view', async () =>
    {
        await mountBar({ buffer: '---\ntitle: x\n---\n\nBody', role: 'viewer' });

        expect(menuLabels()).toEqual([ 'View properties' ]);
    });

    it('offers a viewer no properties entry for a file without frontmatter', async () =>
    {
        await mountBar({ buffer: '# Body', role: 'viewer' });

        expect(menuLabels()).toEqual([]);
    });

    it('marks the entry as a warning when the frontmatter can\'t be read as properties', async () =>
    {
        await mountBar({ buffer: '---\ntitle: [unclosed\n---\n\nBody' });

        expect(header().querySelector('.menu-item')
            ?.getAttribute('data-color')).toBe('warning');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownIdentityBar title', () =>
{
    const TITLED = '---\ntitle: Hello World\n---\n\n# Body';

    beforeEach(() =>
    {
        vi.restoreAllMocks();
        setActivePinia(createPinia());
        makeTarget();
    });

    afterEach(() => { document.getElementById(HEADER_ID)?.remove(); });

    it('shows the frontmatter title in place of the file name, with the file name on hover', async () =>
    {
        await mountBar({ buffer: TITLED });

        const title = header().querySelector('button[title="notes.md"]');
        expect(title?.textContent?.trim()).toBe('Hello World');
        expect(header().textContent).not.toContain('notes.md');
    });

    it('edits the title property, not the file name, when the title is changed', async () =>
    {
        const store = useEditorStore();
        const renameSpy = vi.spyOn(store, 'rename');
        store.$patch({ autosaveEnabled: false });
        await mountBar({ buffer: TITLED });

        header().querySelector<HTMLButtonElement>('button[title="notes.md"]')
            ?.click();
        await nextTick();
        const input = header().querySelector<HTMLInputElement>('input');
        if(input === null) { throw new Error('title input missing'); }
        input.value = 'Goodbye';
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await flushPromises();

        expect(store.buffer).toBe('---\ntitle: Goodbye\n---\n\n# Body');
        expect(renameSpy).not.toHaveBeenCalled();
    });

    it('shows a viewer the title as plain text, with the file name on hover', async () =>
    {
        await mountBar({ buffer: TITLED, role: 'viewer' });

        expect(header().querySelector('button[title="notes.md"]')).toBeNull();
        expect(header().querySelector('[title="notes.md"]')?.textContent?.trim()).toBe('Hello World');
    });

    it('keeps the file name, renamed by clicking, when there is no title', async () =>
    {
        await mountBar({ buffer: '# Body' });

        expect(header().querySelector('button[title="Rename"]')?.textContent?.trim()).toBe('notes.md');
    });

    it('names the browser tab after the title while the file is open', async () =>
    {
        const app = useAppStore();
        const wrapper = await mountBar({ buffer: TITLED });

        expect(app.pageTitle).toBe('Hello World');

        wrapper.unmount();

        expect(app.pageTitle).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
