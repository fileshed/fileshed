//----------------------------------------------------------------------------------------------------------------------
// Markdown Code Block — the language picker and Mermaid diagrams
//
// The contract: each code block shows the language its fence names, by the language's name, or the fence's own word
// for a language it doesn't know. Picking a language rewrites only the fence's language; picking the one shown writes
// nothing. A document that can't be edited shows the language without a picker. A Mermaid block draws its diagram in
// place of its code while the cursor is elsewhere, and shows its code, with Mermaid's message when Mermaid can't read
// it, otherwise. Mermaid itself is replaced, since it needs a browser's layout to draw.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { markRaw, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { Editor } from '@tiptap/core';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Under test
import MarkdownCodeBlock from '@client/components/handlers/markdown/codeBlock.vue';

// Support
import { fileNode } from '../../../support.ts';
import { closeEditors, openMarkdown } from '../../../engines/markdown/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const mermaid = vi.hoisted(() => ({ renderMermaid: vi.fn() }));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));
vi.mock('@client/components/handlers/markdown/mermaid.ts', () => mermaid);

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

let wrappers : VueWrapper[] = [];

interface MountedBlock
{
    live : Editor;
    block : VueWrapper;
    updates : unknown[];
}

// The file opens with a code block fenced with `info`, and the cursor starts in the line after it.
function mountBlock(info : string | null, role : Role = 'owner', code = 'code') : MountedBlock
{
    useEditorStore().$patch({ node: fileNode({ name: 'notes.md', role }) });

    const live = openMarkdown(`\`\`\`${ info ?? '' }\n${ code }\n\`\`\`\nAfter`, []);
    live.commands.setTextSelection(live.state.doc.content.size - 1);

    const updates : unknown[] = [];
    const block = mount(MarkdownCodeBlock, {
        props: {
            editor: markRaw(live),
            node: live.state.doc.child(0),
            getPos: () => 0,
            updateAttributes: vi.fn((attributes : unknown) => { updates.push(attributes); }),
        } as never,
        global: { stubs },
        attachTo: document.body,
    });
    wrappers.push(block);

    return { live, block, updates };
}

function diagramShown(block : VueWrapper) : string
{
    const codeHidden = (block.find('pre').element as HTMLElement).style.display === 'none';
    const diagram = block.find('svg');

    if(diagram.exists() && codeHidden) { return diagram.text(); }
    if(!diagram.exists() && !codeHidden) { return 'code'; }

    return 'both or neither';
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
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        mermaid.renderMermaid.mockReset();
    });

    afterEach(() =>
    {
        wrappers.forEach((wrapper) => wrapper.unmount());
        wrappers = [];
        closeEditors();
    });

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

describe('MarkdownCodeBlock, for a Mermaid block', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        mermaid.renderMermaid.mockReset();
        mermaid.renderMermaid.mockImplementation(async (source : string) => `<svg>${ source }</svg>`);
    });

    afterEach(() =>
    {
        wrappers.forEach((wrapper) => wrapper.unmount());
        wrappers = [];
        closeEditors();
    });

    it('draws its diagram in place of its code while the cursor is elsewhere', async () =>
    {
        const { block } = mountBlock('mermaid', 'owner', 'graph TD');
        await flushPromises();

        expect(diagramShown(block)).toBe('graph TD');
    });

    it('shows its code while the cursor is in it, and the diagram again once the cursor leaves', async () =>
    {
        const { live, block } = mountBlock('mermaid', 'owner', 'graph TD');
        await flushPromises();

        live.commands.setTextSelection(2);
        await flushPromises();
        expect(diagramShown(block)).toBe('code');

        live.commands.setTextSelection(live.state.doc.content.size - 1);
        await flushPromises();
        expect(diagramShown(block)).toBe('graph TD');
    });

    it('shows its code with Mermaid\'s message when Mermaid can\'t read it', async () =>
    {
        mermaid.renderMermaid.mockRejectedValue(new Error('Parse error on line 1'));

        const { block } = mountBlock('mermaid', 'owner', 'not a diagram');
        await flushPromises();

        expect(diagramShown(block)).toBe('code');
        expect(block.find('.text-error').text()).toBe('Parse error on line 1');
    });

    it('puts the cursor in the code when the diagram is clicked', async () =>
    {
        const { live, block } = mountBlock('mermaid', 'owner', 'graph TD');
        await flushPromises();

        await block.find('svg').trigger('mousedown');

        expect(live.state.selection.from).toBe(1);
    });

    it('draws no diagram for a block in another language', async () =>
    {
        const { block } = mountBlock('js', 'owner', 'graph TD');
        await flushPromises();

        expect(diagramShown(block)).toBe('code');
        expect(mermaid.renderMermaid).not.toHaveBeenCalled();
    });
});

//----------------------------------------------------------------------------------------------------------------------
