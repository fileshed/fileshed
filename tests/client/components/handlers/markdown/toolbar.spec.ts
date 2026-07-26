//----------------------------------------------------------------------------------------------------------------------
// Markdown Formatting Toolbar — the word-processor controls
//
// The fixed toolbar hands UEditorToolbar a grouped item list; the library resolves each kind against the editor's
// handler registry and renders the buttons. UEditorToolbar can't drive under jsdom, so it is stubbed at the boundary to
// capture the items, layout, and editor the toolbar hands it, and the assertions read the composition off that capture.
// What this guards, against the agreed groups: it mounts as a fixed toolbar over the live editor; the groups are the
// agreed six (so separators sit between them); every control carries an aria-label; the paragraph-style control is a
// single dropdown offering Normal text / Heading 1-3 wired to the paragraph and heading handlers -- never three heading
// buttons; the inline marks are bold/italic/strike/code with no underline; lists carry indent and outdent; and the
// insert menu is a dropdown offering a table and a horizontal rule.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { type VueWrapper, mount } from '@vue/test-utils';
import { type Component, defineComponent, h } from 'vue';

// Under test
import MarkdownFormatToolbar from '@client/components/handlers/markdown/toolbar.vue';

//----------------------------------------------------------------------------------------------------------------------

interface Item
{
    'kind' ?: string;
    'mark' ?: string;
    'level' ?: number;
    'label' ?: string;
    'aria-label' ?: string;
    'items' ?: Item[][];
}

const capture
    = {
        items: [] as Item[][],
        layout: '',
        editor: null as unknown,
    };

const UEditorToolbarStub = defineComponent({
    name: 'UEditorToolbar',
    props: {
        items: { type: Array, default: () => [] },
        layout: { type: String, default: 'fixed' },
        editor: { type: Object, default: null },
    },
    setup(props)
    {
        return () =>
        {
            capture.items = props.items as Item[][];
            capture.layout = props.layout;
            capture.editor = props.editor;

            return h('div', { class: 'format-toolbar' });
        };
    },
});

const globalStubs : Record<string, Component> = { UEditorToolbar: UEditorToolbarStub };

// A stand-in for the live editor: the toolbar's item list is static, so the fake only has to be forwarded through.
const fakeEditor = { id: 'editor' };

function mountToolbar() : VueWrapper
{
    return mount(MarkdownFormatToolbar, {
        props: { editor: fakeEditor as never },
        global: { stubs: globalStubs },
    });
}

function topLevel() : Item[]
{
    return capture.items.flat();
}

function kinds() : (string | undefined)[]
{
    return topLevel().map((item) => item.kind);
}

function dropdownWithChildKind(kind : string) : Item | undefined
{
    return topLevel().find((item) => (item.items ?? []).flat().some((child) => child.kind === kind));
}

//----------------------------------------------------------------------------------------------------------------------

describe('MarkdownFormatToolbar', () =>
{
    it('mounts as a fixed toolbar over the live editor', () =>
    {
        mountToolbar();

        expect(capture.layout).toBe('fixed');
        expect(capture.editor).toStrictEqual(fakeEditor);
    });

    it('lays the controls out in the agreed six groups so separators sit between them', () =>
    {
        mountToolbar();

        expect(capture.items).toHaveLength(6);
    });

    it('gives every control an aria-label', () =>
    {
        mountToolbar();

        for(const item of topLevel())
        {
            expect(typeof item['aria-label']).toBe('string');
            expect(item['aria-label']).not.toBe('');
        }
    });

    it('offers undo and redo', () =>
    {
        mountToolbar();

        expect(kinds()).toContain('undo');
        expect(kinds()).toContain('redo');
    });

    it('offers the paragraph style as one dropdown of Normal text / Heading 1-3, not three heading buttons', () =>
    {
        mountToolbar();

        // No heading button sits at the top level -- the block style is a single control.
        expect(topLevel().filter((item) => item.kind === 'heading')).toHaveLength(0);

        const styleMenu = dropdownWithChildKind('paragraph');
        const children = (styleMenu?.items ?? []).flat();

        expect(children.map((child) => child.label)).toEqual([ 'Normal text', 'Heading 1', 'Heading 2', 'Heading 3' ]);
        expect(children.map((child) => child.kind)).toEqual([ 'paragraph', 'heading', 'heading', 'heading' ]);
        expect(children.map((child) => child.level)).toEqual([ undefined, 1, 2, 3 ]);
    });

    it('offers the inline marks bold, italic, strikethrough, and inline code -- and no underline', () =>
    {
        mountToolbar();

        const marks = topLevel().filter((item) => item.kind === 'mark')
            .map((item) => item.mark);

        expect(marks).toEqual([ 'bold', 'italic', 'strike', 'code' ]);
        expect(marks).not.toContain('underline');
    });

    it('offers link, the three list kinds, and indent / outdent', () =>
    {
        mountToolbar();

        for(const kind of [ 'link', 'bulletList', 'orderedList', 'taskList', 'indent', 'outdent' ])
        {
            expect(kinds()).toContain(kind);
        }
    });

    it('offers blockquote, code block, and an insert menu of table and horizontal rule', () =>
    {
        mountToolbar();

        expect(kinds()).toContain('blockquote');
        expect(kinds()).toContain('codeBlock');

        const insertMenu = dropdownWithChildKind('table');
        const children = (insertMenu?.items ?? []).flat();

        expect(children.map((child) => child.kind)).toEqual([ 'table', 'horizontalRule' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
