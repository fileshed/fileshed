//----------------------------------------------------------------------------------------------------------------------
// Markdown HTML Banner — the offer to render someone else's HTML
//
// The contract: a document holding HTML that isn't rendering gets a banner offering "Show HTML", and choosing it
// renders the HTML and removes the banner. A document whose HTML already renders, or whose only HTML is comments, gets
// none. The banner follows changes to the document. Driven through a real TipTap editor with the markdown HTML nodes.
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
import MarkdownHTMLBanner from '@client/components/handlers/markdown/htmlBanner.vue';

// Support
import { fileNode } from '../../../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

const UAlertStub = {
    name: 'UAlert',
    props: [ 'title', 'actions' ],
    template: '<div class="banner">{{ title }}'
        + '<button v-for="action in actions" :key="action.label" @click="action.onClick()">{{ action.label }}</button>'
        + '</div>',
};

let editor : Editor | null = null;

function mountBanner(markdown : string, role : Role) : { live : Editor; banner : VueWrapper }
{
    useEditorStore().$patch({ node: fileNode({ name: 'notes.md', role }) });

    editor = new Editor({
        element: document.createElement('div'),
        extensions: [ StarterKit, Markdown, HtmlBlock, HtmlInline ],
    });
    editor.commands.setContent(markdown, { contentType: 'markdown' });

    // Raw, as TipTap's Vue editor marks itself: ProseMirror rejects a transaction built against a proxied document.
    const banner = mount(MarkdownHTMLBanner, {
        props: { editor: markRaw(editor) },
        global: { stubs: { UAlert: UAlertStub } },
    });

    return { live: editor, banner };
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownHTMLBanner', () =>
{
    beforeEach(() => { setActivePinia(createPinia()); });

    afterEach(() =>
    {
        editor?.destroy();
        editor = null;
    });

    it('offers to show the HTML in a file someone else owns', () =>
    {
        const { banner } = mountBanner('Press <kbd>Ctrl</kbd> to copy', 'viewer');

        expect(banner.find('.banner').exists()).toBe(true);
        expect(banner.find('button').text()).toBe('Show HTML');
    });

    it('shows no banner when the HTML already renders', () =>
    {
        const { banner } = mountBanner('<div align="center">Hi</div>\n\nAfter', 'owner');

        expect(banner.find('.banner').exists()).toBe(false);
    });

    it('shows no banner when the only HTML is a comment', () =>
    {
        const { banner } = mountBanner('<!-- a note -->\n\nText', 'viewer');

        expect(banner.find('.banner').exists()).toBe(false);
    });

    it('renders the HTML and removes the banner once the reader chooses to show it', async () =>
    {
        const { banner } = mountBanner('Press <kbd>Ctrl</kbd> to copy', 'viewer');

        await banner.find('button').trigger('click');

        expect(useMarkdownHTMLStore().rendered).toBe(true);
        expect(banner.find('.banner').exists()).toBe(false);
    });

    it('appears when HTML is added to the document', async () =>
    {
        const { live, banner } = mountBanner('Plain text', 'viewer');

        live.commands.setContent('Press <kbd>Ctrl</kbd> to copy', { contentType: 'markdown' });
        await nextTick();

        expect(banner.find('.banner').exists()).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
