//----------------------------------------------------------------------------------------------------------------------
// Markdown Outline Panel — tags and the outline in the page's margin
//
// The contract: the panel lists the frontmatter's tags and the document's headings, indented by level below the
// shallowest one, and says so when there are no headings yet; the word count sits below them. It marks the section
// the cursor is in and follows the cursor; choosing a heading puts the cursor at its start and scrolls it to the top.
// The outline follows every change to the document, a resync that fires no update included. It opens or closes on its
// toggle, remembers that choice in the browser, opens by default, and carries data-open while open, which the editor
// reads to keep the page clear of it. Driven through a real TipTap editor, since the outline is read from its document.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { markRaw, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Under test
import MarkdownOutlinePanel from '@client/components/handlers/markdown/outlinePanel.vue';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const OPEN_KEY = 'fileshed.markdown.outlinePanelOpen';

const stubs = {
    UTooltip: { template: '<slot />' },
    UButton: {
        props: [ 'icon' ],
        emits: [ 'click' ],
        template: '<button class="toggle" @click="$emit(\'click\')" />',
    },
    UBadge: { props: [ 'label' ], template: '<span class="tag">{{ label }}</span>' },
};

let editor : Editor | null = null;
let wrapper : VueWrapper | null = null;
const scrolled : string[] = [];

function mountPanel(markdown : string, frontmatter = '') : { live : Editor; panel : VueWrapper }
{
    useEditorStore().$patch({ buffer: `${ frontmatter }${ markdown }` });

    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({ element, content: markdown, contentType: 'markdown', extensions: [ StarterKit, Markdown ] });

    // Raw, as TipTap's Vue editor marks itself: mount props are made reactive, and ProseMirror rejects a transaction
    // built against a proxied document.
    wrapper = mount(MarkdownOutlinePanel, { props: { editor: markRaw(editor) }, global: { stubs } });

    return { live: editor, panel: wrapper };
}

function entries(panel : VueWrapper) : { text : string; indent : string }[]
{
    return panel.findAll('nav li button').map((button) =>
    {
        return { text: button.text(), indent: button.classes().find((name) => name.startsWith('ps-')) ?? '' };
    });
}

function current(panel : VueWrapper) : string | null
{
    return panel.find('[aria-current="location"]').element?.textContent?.trim() ?? null;
}

beforeEach(() =>
{
    setActivePinia(createPinia());
    window.localStorage.clear();
    scrolled.length = 0;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView(this : HTMLElement) : void
    {
        scrolled.push(this.textContent ?? '');
    };
});

afterEach(() =>
{
    wrapper?.unmount();
    editor?.destroy();
    wrapper = null;
    editor = null;
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownOutlinePanel contents', () =>
{
    it('lists the headings indented by level below the shallowest one', () =>
    {
        const { panel } = mountPanel('## Setup\n\n### Details\n\n## Usage\n\nText');

        expect(entries(panel)).toEqual([
            { text: 'Setup', indent: 'ps-3' },
            { text: 'Details', indent: 'ps-6' },
            { text: 'Usage', indent: 'ps-3' },
        ]);
    });

    it('shows the frontmatter tags', () =>
    {
        const { panel } = mountPanel('# Body\n\nText', '---\ntags: [research, draft]\n---\n\n');

        expect(panel.findAll('.tag').map((tag) => tag.text())).toEqual([ 'research', 'draft' ]);
    });

    it('says where headings will appear when the document has none', () =>
    {
        const { panel } = mountPanel('Just text');

        expect(panel.get('nav').text()).toContain('Headings you add to the document appear here.');
        expect(panel.find('.tag').exists()).toBe(false);
    });

    it('shows the document\'s word count below the outline', () =>
    {
        const { panel } = mountPanel('# Intro\n\nTwo words');

        const text = panel.text();
        expect(text).toContain('3 words');
        expect(text.indexOf('3 words')).toBeGreaterThan(text.indexOf('Intro'));
    });

    it('follows a document change that fires no update', async () =>
    {
        const { live, panel } = mountPanel('# One\n\nText');

        live.commands.setContent('# One\n\n## Two\n\nText', { contentType: 'markdown', emitUpdate: false });
        await nextTick();

        expect(entries(panel).map((entry) => entry.text)).toEqual([ 'One', 'Two' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownOutlinePanel position', () =>
{
    it('marks the section the cursor is in, and follows the cursor', async () =>
    {
        const { live, panel } = mountPanel('# Intro\n\nText\n\n## Usage\n\nMore');

        live.commands.setTextSelection(live.state.doc.content.size - 1);
        await nextTick();
        expect(current(panel)).toBe('Usage');

        live.commands.setTextSelection(2);
        await nextTick();
        expect(current(panel)).toBe('Intro');
    });

    it('puts the cursor at the start of a chosen heading and scrolls it into view', async () =>
    {
        const { live, panel } = mountPanel('# Intro\n\nText\n\n## Usage\n\nMore');

        await panel.findAll('nav li button')[1]?.trigger('click');

        const { $from } = live.state.selection;
        expect($from.parent.textContent).toBe('Usage');
        expect($from.parentOffset).toBe(0);
        expect(scrolled).toEqual([ 'Usage' ]);
        expect(current(panel)).toBe('Usage');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownOutlinePanel toggle', () =>
{
    it('opens by default, marked open for the editor\'s margin', () =>
    {
        const { panel } = mountPanel('# Intro');

        expect(panel.find('nav').exists()).toBe(true);
        expect(panel.get('.md-outline').attributes()).toHaveProperty('data-open');
    });

    it('closes on its toggle, drops the open mark, and remembers the choice', async () =>
    {
        const { panel } = mountPanel('# Intro');

        await panel.get('.toggle').trigger('click');

        expect(panel.find('nav').exists()).toBe(false);
        expect(panel.text()).not.toContain('word');
        expect(panel.get('.md-outline').attributes()).not.toHaveProperty('data-open');
        expect(window.localStorage.getItem(OPEN_KEY)).toBe('false');
    });

    it('starts closed when the browser remembers it closed', () =>
    {
        window.localStorage.setItem(OPEN_KEY, 'false');

        const { panel } = mountPanel('# Intro');

        expect(panel.find('nav').exists()).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
