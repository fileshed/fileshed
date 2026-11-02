//----------------------------------------------------------------------------------------------------------------------
// Markdown HTML Inline — an inline piece of HTML in Preview
//
// The contract: while the file's HTML isn't rendering, the piece shows its source, and while it renders, the sanitized
// HTML. A piece that draws nothing once sanitized shows its source either way.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Under test
import MarkdownHTMLInline from '@client/components/handlers/markdown/htmlInline.vue';

// Support
import { fileNode } from '../../../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));

//----------------------------------------------------------------------------------------------------------------------

async function mountPiece(source : string, role : Role) : Promise<VueWrapper>
{
    useEditorStore().$patch({ node: fileNode({ name: 'notes.md', role }) });

    const piece = mount(MarkdownHTMLInline, {
        props: { node: { attrs: { source } } } as never,
        global: { stubs: { NodeViewWrapper: { template: '<span><slot /></span>' } } },
    });
    await flushPromises();

    return piece;
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownHTMLInline', () =>
{
    beforeEach(() => { setActivePinia(createPinia()); });

    it('shows its source while the HTML is not rendering', async () =>
    {
        const piece = await mountPiece('<kbd>Ctrl</kbd>', 'editor');

        expect(piece.find('.md-html-render').exists()).toBe(false);
        expect(piece.find('code').text()).toBe('<kbd>Ctrl</kbd>');
    });

    it('shows the sanitized HTML while it renders', async () =>
    {
        const piece = await mountPiece('<kbd onclick="steal()">Ctrl</kbd>', 'owner');

        expect(piece.find('code').exists()).toBe(false);
        expect(piece.find('.md-html-render kbd').text()).toBe('Ctrl');
        expect(piece.find('.md-html-render [onclick]').exists()).toBe(false);
    });

    it('shows its source when the piece draws nothing once sanitized', async () =>
    {
        const piece = await mountPiece('<a name="anchor"></a>', 'owner');

        expect(piece.find('.md-html-render').exists()).toBe(false);
        expect(piece.find('code').text()).toBe('<a name="anchor"></a>');
    });
});

//----------------------------------------------------------------------------------------------------------------------
