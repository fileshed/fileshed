//----------------------------------------------------------------------------------------------------------------------
// Markdown Inline Math — the drawing in place of `$…$`
//
// The contract: the widget draws its LaTeX as inline math, and shows the LaTeX as code while KaTeX loads. A press on
// it puts the cursor just inside the math's source, which sits right after it, unless the document can't be edited.
// KaTeX itself is replaced with a stand-in that echoes what it was asked to draw.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { markRaw } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

import type { Editor } from '@tiptap/core';

import type { Role } from '@fileshed/core';

// Stores
import { useEditorStore } from '@client/stores/editor.ts';

// Engines
import { InlineMath, findInlineMath } from '@client/engines/markdown/math.ts';

// Under test
import MarkdownInlineMath from '@client/components/handlers/markdown/inlineMath.vue';

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

let wrapper : VueWrapper | null = null;

// A widget for the math in `A $x^2$ b`, with the cursor at the end of the line.
function mountWidget(role : Role = 'owner') : { live : Editor; widget : VueWrapper; mathFrom : number }
{
    useEditorStore().$patch({ node: fileNode({ name: 'notes.md', role }) });

    const live = openMarkdown('A $x^2$ b', [ InlineMath ]);
    live.commands.setTextSelection(live.state.doc.content.size - 1);
    const mathFrom = findInlineMath(live.state.doc)[0]?.from ?? -1;

    wrapper = mount(MarkdownInlineMath, { props: { editor: markRaw(live), getPos: () => mathFrom, latex: 'x^2' } });

    return { live, widget: wrapper, mathFrom };
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownInlineMath', () =>
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

    it('draws its LaTeX as inline math', () =>
    {
        expect(mountWidget().widget.find('.drawn').text()).toBe('x^2|inline');
    });

    it('shows its LaTeX as code while KaTeX loads', () =>
    {
        katex.loaded = false;

        expect(mountWidget().widget.find('code').text()).toBe('x^2');
    });

    it('puts the cursor just inside the math\'s source when pressed', async () =>
    {
        const { live, widget, mathFrom } = mountWidget();

        await widget.trigger('mousedown');

        expect(live.state.selection.from).toBe(mathFrom + 1);
    });

    it('leaves the cursor where it is when the document can\'t be edited', async () =>
    {
        const { live, widget } = mountWidget('viewer');

        await widget.trigger('mousedown');

        expect(live.state.selection.from).toBe(live.state.doc.content.size - 1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
