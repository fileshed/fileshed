//----------------------------------------------------------------------------------------------------------------------
// Markdown Word Count
//
// The contract: it shows the document's word count, and while text is selected, the selection's count of that total.
// Each block's words count apart from its neighbors', and the count follows every change to the document and the
// selection. Driven through a real TipTap editor, since the count is read from its document.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { markRaw, nextTick } from 'vue';

import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

// Under test
import MarkdownWordCount from '@client/components/handlers/markdown/wordCount.vue';

//----------------------------------------------------------------------------------------------------------------------

let editor : Editor | null = null;
let wrapper : VueWrapper | null = null;

function mountCount(markdown : string) : { live : Editor; count : VueWrapper }
{
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({ element, content: markdown, contentType: 'markdown', extensions: [ StarterKit, Markdown ] });

    // Raw, as TipTap's Vue editor marks itself: ProseMirror rejects a transaction built against a proxied document.
    wrapper = mount(MarkdownWordCount, { props: { editor: markRaw(editor), lang: null } });

    return { live: editor, count: wrapper };
}

afterEach(() =>
{
    wrapper?.unmount();
    editor?.destroy();
    wrapper = null;
    editor = null;
});

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownWordCount', () =>
{
    it('shows the document\'s word count', () =>
    {
        expect(mountCount('Hello brave new world').count.text()).toBe('4 words');
    });

    it('says word, singular, for a one-word document', () =>
    {
        expect(mountCount('Hello').count.text()).toBe('1 word');
    });

    it('counts the last word of one block apart from the first word of the next', () =>
    {
        const { count } = mountCount('# Title\n\nOne\n\n- two\n- three');

        expect(count.text()).toBe('4 words');
    });

    it('shows the selection\'s count of the total while text is selected, and the total once it is not', async () =>
    {
        const { live, count } = mountCount('Hello brave new world');

        // "brave new": the paragraph's text starts at position 1, so "brave" begins at 7 and "new" ends at 16.
        live.commands.setTextSelection({ from: 7, to: 16 });
        await nextTick();
        expect(count.text()).toBe('2 of 4 words');

        live.commands.setTextSelection(1);
        await nextTick();
        expect(count.text()).toBe('4 words');
    });

    it('follows an edit to the document', async () =>
    {
        const { live, count } = mountCount('Hello world');

        live.commands.insertContentAt(live.state.doc.content.size - 1, ' again and again');
        await nextTick();

        expect(count.text()).toBe('5 words');
    });
});

//----------------------------------------------------------------------------------------------------------------------
