//----------------------------------------------------------------------------------------------------------------------
// Markdown HTML Block — an HTML block in Preview
//
// The contract: while the file's HTML isn't rendering, the block shows its source. While it renders, the block shows
// the sanitized HTML, except while the cursor is in the block and when the HTML draws nothing, so it can't be deleted
// unseen; both show the source. Clicking the rendered HTML puts the cursor in the source, unless the click is on a
// link or the document can't be edited. Driven through a real TipTap editor, since the cursor is read from its
// selection.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { markRaw, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';
import { useMarkdownHTMLStore } from '@client/stores/markdownHTML.ts';

// Engines
import { HtmlBlock, HtmlInline } from '@client/engines/markdown/html.ts';

// Under test
import MarkdownHTMLBlock from '@client/components/handlers/markdown/htmlBlock.vue';

// Support
import { fileNode } from '../../../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const stubs = {
    NodeViewWrapper: { template: '<div><slot /></div>' },
    NodeViewContent: { template: '<code />' },
};

let editor : Editor | null = null;
let wrapper : VueWrapper | null = null;

// The file opens with the HTML block, followed by a paragraph the cursor starts in.
function mountBlock(source : string, role : Role) : { live : Editor; block : VueWrapper }
{
    useEditorStore().$patch({ node: fileNode({ name: 'notes.md', role }) });

    editor = new Editor({
        element: document.createElement('div'),
        extensions: [ StarterKit, Markdown, HtmlBlock, HtmlInline ],
    });
    editor.commands.setContent(`${ source }\n\nAfter`, { contentType: 'markdown' });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    const live = editor;
    wrapper = mount(MarkdownHTMLBlock, {
        props: {
            editor: markRaw(live),
            node: live.state.doc.child(0),
            getPos: () => 0,
        } as never,
        global: { stubs },
        attachTo: document.body,
    });

    return { live, block: wrapper };
}

function shown(block : VueWrapper) : string
{
    const rendered = block.find('.md-html-render').exists();
    const sourceHidden = (block.find('pre').element as HTMLElement).style.display === 'none';

    if(rendered && sourceHidden) { return 'rendered'; }
    if(!rendered && !sourceHidden) { return 'source'; }

    return 'both or neither';
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownHTMLBlock', () =>
{
    beforeEach(() => { setActivePinia(createPinia()); });

    afterEach(() =>
    {
        wrapper?.unmount();
        wrapper = null;
        editor?.destroy();
        editor = null;
    });

    it('shows its source while the HTML is not rendering', () =>
    {
        const { block } = mountBlock('<div align="center"><b>Hi</b></div>', 'editor');

        expect(shown(block)).toBe('source');
    });

    it('shows the sanitized HTML while it renders', () =>
    {
        const { block } = mountBlock('<div align="center"><b>Hi</b><script>steal()</script></div>', 'owner');

        expect(shown(block)).toBe('rendered');
        expect(block.find('.md-html-render b').text()).toBe('Hi');
        expect(block.find('.md-html-render script').exists()).toBe(false);
    });

    it('shows its source while the cursor is in it, and the HTML again once the cursor leaves', async () =>
    {
        const { live, block } = mountBlock('<div align="center"><b>Hi</b></div>', 'owner');

        live.commands.setTextSelection(3);
        await nextTick();
        expect(shown(block)).toBe('source');

        live.commands.setTextSelection(live.state.doc.content.size - 1);
        await nextTick();
        expect(shown(block)).toBe('rendered');
    });

    it('shows its source when the HTML draws nothing once sanitized', () =>
    {
        const { block } = mountBlock('<div><a name="anchor"></a></div>', 'owner');

        expect(shown(block)).toBe('source');
    });

    it('puts the cursor in the source when the rendered HTML is clicked', async () =>
    {
        const { live, block } = mountBlock('<div align="center"><b>Hi</b></div>', 'owner');
        const blockSize = live.state.doc.child(0).nodeSize;

        await block.find('.md-html-render b').trigger('mousedown');

        const { from } = live.state.selection;
        expect(from > 0 && from < blockSize).toBe(true);
        expect(shown(block)).toBe('source');
    });

    it('leaves the cursor where it was when the click is on a link', async () =>
    {
        const { live, block } = mountBlock('<div><a href="https://example.com">site</a></div>', 'owner');
        const before = live.state.selection.from;

        await block.find('.md-html-render a').trigger('mousedown');

        expect(live.state.selection.from).toBe(before);
        expect(shown(block)).toBe('rendered');
    });

    it('leaves the cursor where it was when the document can\'t be edited', async () =>
    {
        const { live, block } = mountBlock('<div align="center"><b>Hi</b></div>', 'viewer');
        useMarkdownHTMLStore().show();
        await nextTick();
        const before = live.state.selection.from;

        await block.find('.md-html-render').trigger('mousedown');

        expect(live.state.selection.from).toBe(before);
    });
});

//----------------------------------------------------------------------------------------------------------------------
