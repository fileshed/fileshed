//----------------------------------------------------------------------------------------------------------------------
// Markdown Code Block — the language picker
//
// The contract: each code block shows the language its fence names, by the language's name, or the fence's own word
// for a language it doesn't know. Picking a language rewrites only the fence's language; picking the one shown writes
// nothing. A document that can't be edited shows the language without a picker.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Under test
import MarkdownCodeBlock from '@client/components/handlers/markdown/codeBlock.vue';

// Support
import { fileNode } from '../../../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const USelectMenuStub = {
    name: 'USelectMenu',
    props: [ 'modelValue', 'items' ],
    emits: [ 'update:modelValue' ],
    template: '<select class="language" :value="modelValue.value" '
        + '@change="$emit(\'update:modelValue\', items.find((item) => item.value === $event.target.value))">'
        + '<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>'
        + '</select>',
};

const stubs = {
    USelectMenu: USelectMenuStub,
    NodeViewWrapper: { template: '<div><slot /></div>' },
    NodeViewContent: { template: '<code />' },
};

function mountBlock(language : string | null, role : Role = 'owner') : { block : VueWrapper; updates : unknown[] }
{
    useEditorStore().$patch({ node: fileNode({ name: 'notes.md', role }) });

    const updates : unknown[] = [];
    const block = mount(MarkdownCodeBlock, {
        props: {
            node: { attrs: { language } },
            updateAttributes: vi.fn((attributes : unknown) => { updates.push(attributes); }),
        } as never,
        global: { stubs },
    });

    return { block, updates };
}

function shown(block : VueWrapper) : string
{
    const select = block.find('select.language');
    if(!select.exists()) { return block.text(); }

    const element = select.element as HTMLSelectElement;
    return element.selectedOptions[0]?.textContent ?? '';
}

async function pick(block : VueWrapper, label : string) : Promise<void>
{
    const options = block.findAll('option').map((option) => option.element as HTMLOptionElement);
    const value = options.find((option) => option.textContent === label)?.value ?? '';

    await block.find('select.language').setValue(value);
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownCodeBlock', () =>
{
    beforeEach(() => { setActivePinia(createPinia()); });

    it('shows the language the fence names by the language\'s name, whichever alias the fence uses', () =>
    {
        expect(shown(mountBlock('js').block)).toBe('JavaScript');
        expect(shown(mountBlock('python title="a.py"').block)).toBe('Python');
    });

    it('shows a language it doesn\'t know as the fence spells it, and plain text for no language', () =>
    {
        expect(shown(mountBlock('foobar').block)).toBe('foobar');
        expect(shown(mountBlock(null).block)).toBe('Plain text');
    });

    it('rewrites only the fence\'s language when another one is picked', async () =>
    {
        const { block, updates } = mountBlock('js title="app.js"');

        await pick(block, 'Python');

        expect(updates).toEqual([ { language: 'python title="app.js"' } ]);
    });

    it('clears the fence\'s language when plain text is picked', async () =>
    {
        const { block, updates } = mountBlock('js');

        await pick(block, 'Plain text');

        expect(updates).toEqual([ { language: null } ]);
    });

    it('writes nothing when the language already shown is picked', async () =>
    {
        const { block, updates } = mountBlock('js');

        await pick(block, 'JavaScript');

        expect(updates).toEqual([]);
    });

    it('shows the language without a picker when the document can\'t be edited', () =>
    {
        const { block } = mountBlock('js', 'viewer');

        expect(block.find('select.language').exists()).toBe(false);
        expect(block.text()).toBe('JavaScript');
    });

    it('offers the picker once the document becomes editable', async () =>
    {
        const { block } = mountBlock('js', 'viewer');

        useEditorStore().$patch({ node: fileNode({ name: 'notes.md', role: 'editor' }) });
        await nextTick();

        expect(block.find('select.language').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
