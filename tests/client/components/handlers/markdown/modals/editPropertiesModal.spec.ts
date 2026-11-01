//----------------------------------------------------------------------------------------------------------------------
// Edit Properties Modal — editing frontmatter as typed rows or raw YAML
//
// The contract: the modal opens on the open file's frontmatter, one row per property with a control for its kind;
// edits stay in a draft until Apply writes them into the file (body untouched), and Cancel writes nothing. A file
// without frontmatter can add a first property, which creates the block. YAML that can't be read as properties opens
// in the YAML view with its parse error, and Apply waits until it parses. A viewer can look but change nothing. The
// editor store is real and holds the file; Nuxt UI is stubbed to plain elements at the boundary.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DOMWrapper, type VueWrapper, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Support
import { fileNode } from '../../../../support.ts';

// Under test
import EditPropertiesModal from '@client/components/handlers/markdown/modals/editPropertiesModal.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ getNode: vi.fn(), patchNode: vi.fn() }));
vi.mock('@client/resource-access/content.ts', () => ({ fetchNodeText: vi.fn() }));
vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(),
    uploadTicket: vi.fn(),
    answerChallenge: vi.fn(),
}));
vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const stubs = {
    UModal: {
        props: [ 'open', 'title' ],
        template: '<div v-if="open" class="modal"><slot name="body" /></div>',
    },
    UButton: {
        props: [ 'label', 'disabled', 'type' ],
        emits: [ 'click' ],
        template: '<button :type="type ?? \'button\'" :data-label="label ?? $attrs[\'aria-label\']" '
            + ':disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
    },
    UFieldGroup: { template: '<div><slot /></div>' },
    UInput: {
        props: [ 'modelValue', 'type' ],
        emits: [ 'update:modelValue', 'blur' ],
        template: '<input class="u-input" :type="type ?? \'text\'" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UCheckbox: {
        props: [ 'modelValue', 'disabled' ],
        emits: [ 'update:modelValue' ],
        template: '<input type="checkbox" class="u-checkbox" :checked="modelValue" :disabled="disabled" '
            + '@change="$emit(\'update:modelValue\', $event.target.checked)" />',
    },
    UInputTags: {
        props: [ 'modelValue', 'disabled' ],
        emits: [ 'update:modelValue' ],
        template: '<input class="u-tags" :value="modelValue.join(\',\')" :disabled="disabled" '
            + '@change="$emit(\'update:modelValue\', $event.target.value.split(\',\'))" />',
    },
    USelect: {
        props: [ 'modelValue', 'items' ],
        emits: [ 'update:modelValue' ],
        template: '<select class="u-select" :value="modelValue" '
            + '@change="$emit(\'update:modelValue\', $event.target.value)">'
            + '<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>'
            + '</select>',
    },
    UTextarea: {
        props: [ 'modelValue' ],
        emits: [ 'update:modelValue' ],
        template: '<textarea class="u-textarea" :value="modelValue" '
            + '@input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    UAlert: {
        props: [ 'title' ],
        template: '<div class="u-alert">{{ title }}<slot name="description" /></div>',
    },
};

function mountModal(buffer : string, role : Role = 'owner') : VueWrapper
{
    const store = useEditorStore();
    store.$patch({
        node: fileNode({ name: 'notes.md', mimeType: 'text/markdown', role }),
        buffer,
        autosaveEnabled: false,
    });

    const wrapper = mount(EditPropertiesModal, { global: { stubs } });
    (wrapper.vm as unknown as { open : () => void }).open();

    return wrapper;
}

function button(wrapper : VueWrapper, label : string) : DOMWrapper<HTMLButtonElement> | undefined
{
    return wrapper.findAll<HTMLButtonElement>('button').find((found) => found.attributes('data-label') === label);
}

function field(wrapper : VueWrapper, key : string) : Omit<DOMWrapper<HTMLInputElement>, 'exists'>
{
    return wrapper.get<HTMLInputElement>(`[aria-label="${ key }"]`);
}

async function apply(wrapper : VueWrapper) : Promise<void>
{
    await button(wrapper, 'Apply')?.trigger('click');
}

//----------------------------------------------------------------------------------------------------------------------

describe('EditPropertiesModal', () =>
{
    beforeEach(() => { setActivePinia(createPinia()); });

    it('shows one row per property, each with the control for its kind', async () =>
    {
        const wrapper = mountModal('---\ntitle: Hello\ndraft: true\ntags: [a, b]\ndate: 2024-01-15\n---\n\nBody');
        await wrapper.vm.$nextTick();

        expect(field(wrapper, 'title').element.value).toBe('Hello');
        expect(field(wrapper, 'draft').element.checked).toBe(true);
        expect(field(wrapper, 'tags').element.value).toBe('a,b');
        expect(field(wrapper, 'date').attributes('type')).toBe('date');
        expect(field(wrapper, 'date').element.value).toBe('2024-01-15');
    });

    it('writes an edited value into the frontmatter on Apply, leaving the body alone', async () =>
    {
        const store = useEditorStore();
        const wrapper = mountModal('---\n# keep\ntitle: Hello\ndraft: true\n---\n\n# Body\ntext');
        await wrapper.vm.$nextTick();

        await field(wrapper, 'title').setValue('Goodbye');
        await apply(wrapper);

        expect(store.buffer).toBe('---\n# keep\ntitle: Goodbye\ndraft: true\n---\n\n# Body\ntext');
        expect(wrapper.find('.modal').exists()).toBe(false);
    });

    it('writes nothing on Cancel', async () =>
    {
        const store = useEditorStore();
        const wrapper = mountModal('---\ntitle: Hello\n---\n\nBody');
        await wrapper.vm.$nextTick();

        await field(wrapper, 'title').setValue('Goodbye');
        await button(wrapper, 'Cancel')?.trigger('click');

        expect(store.buffer).toBe('---\ntitle: Hello\n---\n\nBody');
    });

    it('keeps Apply disabled until the draft differs from the file', async () =>
    {
        const wrapper = mountModal('---\ntitle: Hello\n---\n\nBody');
        await wrapper.vm.$nextTick();

        expect(button(wrapper, 'Apply')?.element.disabled).toBe(true);

        await field(wrapper, 'title').setValue('Goodbye');

        expect(button(wrapper, 'Apply')?.element.disabled).toBe(false);
    });

    it('removes a property', async () =>
    {
        const store = useEditorStore();
        const wrapper = mountModal('---\ntitle: Hello\ndraft: true\n---\n\nBody');
        await wrapper.vm.$nextTick();

        await button(wrapper, 'Remove draft')?.trigger('click');
        await apply(wrapper);

        expect(store.buffer).toBe('---\ntitle: Hello\n---\n\nBody');
    });

    it('creates the frontmatter block when a first property is added to a file without one', async () =>
    {
        const store = useEditorStore();
        const wrapper = mountModal('# Body');
        await wrapper.vm.$nextTick();

        await wrapper.get('[aria-label="Property name"]').setValue('draft');
        await wrapper.get('.u-select').setValue('checkbox');
        await wrapper.get('form').trigger('submit');
        await apply(wrapper);

        expect(store.buffer).toBe('---\ndraft: false\n---\n\n# Body');
    });

    it('opens unreadable YAML in the YAML view with its error, and applies it only once it parses', async () =>
    {
        const store = useEditorStore();
        const wrapper = mountModal('---\ntitle: [unclosed\n---\n\nBody');
        await wrapper.vm.$nextTick();

        expect(wrapper.get<HTMLTextAreaElement>('.u-textarea').element.value).toBe('title: [unclosed\n');
        expect(wrapper.find('.u-alert').exists()).toBe(true);
        expect(button(wrapper, 'Properties')?.element.disabled).toBe(true);

        await wrapper.get('.u-textarea').setValue('title: [still, unclosed\n');
        expect(button(wrapper, 'Apply')?.element.disabled).toBe(true);

        await wrapper.get('.u-textarea').setValue('title: Fixed\n');
        await apply(wrapper);

        expect(store.buffer).toBe('---\ntitle: Fixed\n---\n\nBody');
    });

    it('gives a viewer nothing to change', async () =>
    {
        const wrapper = mountModal('---\ntitle: Hello\ndraft: true\n---\n\nBody', 'viewer');
        await wrapper.vm.$nextTick();

        expect(button(wrapper, 'Apply')).toBeUndefined();
        expect(button(wrapper, 'Remove title')).toBeUndefined();
        expect(wrapper.find('form').exists()).toBe(false);
        expect(field(wrapper, 'title').attributes('readonly')).toBeDefined();
        expect(field(wrapper, 'draft').element.disabled).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
