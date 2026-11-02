//----------------------------------------------------------------------------------------------------------------------
// Markdown Math Block — a `$$` block in Preview
//
// The contract: the block draws the LaTeX between its `$$` lines as display math while the cursor is elsewhere. It
// shows its source while the cursor is in it, while KaTeX loads, and when it holds no LaTeX. Clicking the drawn math
// puts the cursor in the source, unless the document can't be edited. KaTeX itself is replaced with a stand-in that
// echoes what it was asked to draw.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { markRaw, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { Editor } from '@tiptap/core';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Engines
import { MathBlock } from '@client/engines/markdown/math.ts';

// Under test
import MarkdownMathBlock from '@client/components/handlers/markdown/mathBlock.vue';

// Support
import { fileNode } from '../../../support.ts';
import { closeEditors, openMarkdown } from '../../../engines/markdown/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const katex = vi.hoisted(() => ({ loaded: true }));

vi.mock('@nuxt/ui/composables', () => ({ useToast: () => ({ add: vi.fn() }) }));
vi.mock('@client/components/handlers/markdown/katex.ts', () => ({
    renderLatex: (latex : string, displayMode : boolean) =>
    {
        return katex.loaded ? `<span class="drawn">${ latex }|${ displayMode ? 'display' : 'inline' }</span>` : null;
    },
}));

//----------------------------------------------------------------------------------------------------------------------

const stubs = {
    NodeViewWrapper: { template: '<div><slot /></div>' },
    NodeViewContent: { template: '<code />' },
};

let wrapper : VueWrapper | null = null;

// The file opens with the block, and the cursor starts in the line after it.
function mountBlock(source : string, role : Role = 'owner') : { live : Editor; block : VueWrapper }
{
    useEditorStore().$patch({ node: fileNode({ name: 'notes.md', role }) });

    const live = openMarkdown(`${ source }\nAfter`, [ MathBlock ]);
    live.commands.setTextSelection(live.state.doc.content.size - 1);

    wrapper = mount(MarkdownMathBlock, {
        props: { editor: markRaw(live), node: live.state.doc.child(0), getPos: () => 0 } as never,
        global: { stubs },
        attachTo: document.body,
    });

    return { live, block: wrapper };
}

function shown(block : VueWrapper) : string
{
    const drawn = block.find('.drawn');
    const sourceHidden = (block.find('pre').element as HTMLElement).style.display === 'none';

    if(drawn.exists() && sourceHidden) { return drawn.text(); }
    if(!drawn.exists() && !sourceHidden) { return 'source'; }

    return 'both or neither';
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownMathBlock', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        katex.loaded = true;
    });

    afterEach(() =>
    {
        wrapper?.unmount();
        wrapper = null;
        closeEditors();
    });

    it('draws the LaTeX between its `$$` lines as display math', () =>
    {
        expect(shown(mountBlock('$$\nx^2\n$$').block)).toBe('x^2|display');
    });

    it('shows its source while the cursor is in it, and the math again once the cursor leaves', async () =>
    {
        const { live, block } = mountBlock('$$\nx^2\n$$');

        live.commands.setTextSelection(4);
        await nextTick();
        expect(shown(block)).toBe('source');

        live.commands.setTextSelection(live.state.doc.content.size - 1);
        await nextTick();
        expect(shown(block)).toBe('x^2|display');
    });

    it('shows its source while KaTeX loads', () =>
    {
        katex.loaded = false;

        expect(shown(mountBlock('$$\nx^2\n$$').block)).toBe('source');
    });

    it('shows its source when it holds no LaTeX', () =>
    {
        expect(shown(mountBlock('$$\n\n$$').block)).toBe('source');
    });

    it('puts the cursor in the source when the drawn math is clicked', async () =>
    {
        const { live, block } = mountBlock('$$\nx^2\n$$');

        await block.find('.drawn').trigger('mousedown');

        expect(live.state.selection.from).toBe(1);
    });

    it('leaves the cursor where it is when the document can\'t be edited', async () =>
    {
        const { live, block } = mountBlock('$$\nx^2\n$$', 'viewer');

        await block.find('.drawn').trigger('mousedown');

        expect(live.state.selection.from).toBe(live.state.doc.content.size - 1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
