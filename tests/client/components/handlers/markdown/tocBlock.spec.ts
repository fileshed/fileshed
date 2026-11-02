//----------------------------------------------------------------------------------------------------------------------
// Markdown Table of Contents — the heading list in Preview
//
// The contract: a table of contents lists the document's headings, indented by level below the shallowest, and kept
// current as they change; choosing one goes to that heading. The marker shows instead while the cursor is on it, and
// whenever its text no longer reads as a marker. Driven through a real TipTap editor, since the headings and the cursor
// are read from it.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { markRaw, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { Editor } from '@tiptap/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Engines
import { TableOfContents } from '@client/engines/markdown/toc.ts';

// Under test
import MarkdownTOCBlock from '@client/components/handlers/markdown/tocBlock.vue';

// Support
import { fileNode } from '../../../support.ts';
import { closeEditors, openMarkdown } from '../../../engines/markdown/support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const stubs = {
    NodeViewWrapper: { template: '<div><slot /></div>' },
    NodeViewContent: { template: '<p />' },
};

let wrapper : VueWrapper | null = null;

// The file opens with the marker, and the cursor starts in the last line.
function mountTOC(markdown : string) : { live : Editor; toc : VueWrapper }
{
    useEditorStore().$patch({ node: fileNode({ name: 'notes.md', role: 'owner' }) });

    const live = openMarkdown(markdown, [ TableOfContents ]);
    live.commands.setTextSelection(live.state.doc.content.size - 1);

    wrapper = mount(MarkdownTOCBlock, {
        props: { editor: markRaw(live), node: live.state.doc.child(0), getPos: () => 0 } as never,
        global: { stubs },
    });

    return { live, toc: wrapper };
}

function entries(toc : VueWrapper) : { text : string; indent : string }[]
{
    return toc.findAll('nav li').map((item) =>
    {
        return { text: item.text(), indent: item.classes().find((name) => name.startsWith('ms-')) ?? '' };
    });
}

function markerShown(toc : VueWrapper) : boolean
{
    return !toc.find('nav').exists() && (toc.find('p').element.parentElement?.style.display ?? '') !== 'none';
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownTOCBlock', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        HTMLElement.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() =>
    {
        wrapper?.unmount();
        wrapper = null;
        closeEditors();
    });

    it('lists the headings indented by level below the shallowest one', () =>
    {
        const { toc } = mountTOC('[TOC]\n## Setup\n### Install\n## Use\nText');

        expect(entries(toc)).toEqual([
            { text: 'Setup', indent: 'ms-0' },
            { text: 'Install', indent: 'ms-4' },
            { text: 'Use', indent: 'ms-0' },
        ]);
    });

    it('says so when the document has no headings', () =>
    {
        const { toc } = mountTOC('[TOC]\nJust text');

        expect(toc.find('nav').text()).toBe('No headings');
    });

    it('lists a heading added after it was drawn', async () =>
    {
        const { live, toc } = mountTOC('[TOC]\n# One\nText');

        live.commands.insertContentAt(live.state.doc.content.size, {
            type: 'heading',
            attrs: { level: 1 },
            content: [ { type: 'text', text: 'Two' } ],
        });
        await nextTick();

        expect(entries(toc).map(({ text }) => text)).toEqual([ 'One', 'Two' ]);
    });

    it('puts the cursor at the heading chosen', async () =>
    {
        const { live, toc } = mountTOC('[TOC]\n# One\n# Two\nText');

        await toc.findAll('nav li a')[1]?.trigger('click');

        expect(live.state.doc.resolve(live.state.selection.from).parent.textContent).toBe('Two');
    });

    it('shows the marker while the cursor is on it, and the list again once the cursor leaves', async () =>
    {
        const { live, toc } = mountTOC('[TOC]\n# One\nText');

        live.commands.setTextSelection(2);
        await nextTick();
        expect(markerShown(toc)).toBe(true);

        live.commands.setTextSelection(live.state.doc.content.size - 1);
        await nextTick();
        expect(markerShown(toc)).toBe(false);
    });

    it('shows its text once it no longer reads as a marker', async () =>
    {
        const { live, toc } = mountTOC('[TOC]\n# One\nText');

        live.commands.insertContentAt(6, ' and more');
        await toc.setProps({ node: live.state.doc.child(0) });
        live.commands.setTextSelection(live.state.doc.content.size - 1);
        await nextTick();

        expect(markerShown(toc)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
