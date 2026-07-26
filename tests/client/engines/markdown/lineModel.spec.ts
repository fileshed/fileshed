//----------------------------------------------------------------------------------------------------------------------
// Markdown Line Model — every visual line is a real line in the file
//
// The contract: blocks join on single newlines, so consecutive paragraphs touch ("a\nb"); a blank line is a real
// empty paragraph, one per blank line ("a\n\nb" is [a, empty, b]); and the mapping is stable across serialize and
// reload. Lists, quotes, and tables lazily swallow a directly-following line (markdown grammar), so the serializer
// writes their terminating blank line itself. Exercised through a real TipTap editor with the same extension stack
// the component wires up, because the round-trip is the contract.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import { Editor, type JSONContent } from '@tiptap/core';
import { TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

// Under test
import {
    BlankLines,
    MarkdownBlockquote,
    MarkdownDocument,
    MarkdownHardBreak,
    MarkdownListItem,
    MarkdownParagraph,
    MarkdownTaskItem,
    lineModelMarked,
} from '@client/engines/markdown/lineModel.ts';

//----------------------------------------------------------------------------------------------------------------------

let editors : Editor[] = [];

function createEditor() : Editor
{
    const editor = new Editor({
        element: document.createElement('div'),
        extensions: [
            Markdown.configure({ marked: lineModelMarked }),
            StarterKit.configure({
                document: false,
                paragraph: false,
                hardBreak: false,
                blockquote: false,
                listItem: false,
            }),
            MarkdownDocument,
            MarkdownBlockquote,
            MarkdownListItem,
            MarkdownParagraph,
            MarkdownHardBreak,
            TaskList,
            MarkdownTaskItem.configure({ nested: true }),
            BlankLines,
            Table,
            TableRow,
            TableHeader,
            TableCell,
        ],
    });

    editors.push(editor);
    return editor;
}

function paragraph(text ?: string) : JSONContent
{
    return text === undefined
        ? { type: 'paragraph' }
        : { type: 'paragraph', content: [ { type: 'text', text } ] };
}

function heading(text : string) : JSONContent
{
    return { type: 'heading', attrs: { level: 1 }, content: [ { type: 'text', text } ] };
}

function setDoc(editor : Editor, blocks : JSONContent[]) : void
{
    editor.commands.setContent({ type: 'doc', content: blocks });
}

function parse(markdown : string) : Editor
{
    const editor = createEditor();
    editor.commands.setContent(markdown, { contentType: 'markdown' });
    return editor;
}

function flatText(node : JSONContent) : string
{
    if(node.text !== undefined) { return node.text; }
    return (node.content ?? []).map(flatText).join('');
}

// One line per block: its type, a pipe, and its flattened text -- an empty paragraph is 'paragraph|'.
function blockShapes(editor : Editor) : string[]
{
    return (editor.getJSON().content ?? []).map((node) => `${ node.type }|${ flatText(node) }`);
}

function shapesAt(editor : Editor, ...path : number[]) : string[]
{
    let nodes = editor.getJSON().content ?? [];
    for(const index of path) { nodes = nodes[index]?.content ?? []; }

    return nodes.map((node) => `${ node.type }|${ flatText(node) }`);
}

// The core line-model guarantee: serializing what was parsed reproduces the input byte-for-byte, and stays a fixed
// point over repeated save/reload cycles -- growth on any cycle is the corruption this spec exists to prevent.
function expectStable(markdown : string) : Editor
{
    const first = parse(markdown);
    expect(first.getMarkdown()).toBe(markdown);

    let current = markdown;
    for(let cycle = 0; cycle < 3; cycle++)
    {
        const editor = parse(current);
        const next = editor.getMarkdown();
        expect(next).toBe(current);
        current = next;
    }

    return first;
}

afterEach(() =>
{
    editors.forEach((editor) => editor.destroy());
    editors = [];
});

//----------------------------------------------------------------------------------------------------------------------

describe('line model: paragraphs', () =>
{
    it('joins touching paragraphs with a single newline, and they stay touching on reload', () =>
    {
        const editor = createEditor();
        setDoc(editor, [ paragraph('a'), paragraph('b') ]);

        expect(editor.getMarkdown()).toBe('a\nb');
        expect(blockShapes(parse('a\nb'))).toEqual([ 'paragraph|a', 'paragraph|b' ]);
    });

    it('maps one blank line to one real empty paragraph, both directions', () =>
    {
        const editor = createEditor();
        setDoc(editor, [ paragraph('a'), paragraph(), paragraph('b') ]);

        expect(editor.getMarkdown()).toBe('a\n\nb');
        expect(blockShapes(parse('a\n\nb'))).toEqual([ 'paragraph|a', 'paragraph|', 'paragraph|b' ]);
    });

    it('maps N blank lines to N empty paragraphs, never &nbsp;', () =>
    {
        const editor = createEditor();
        setDoc(editor, [ paragraph('a'), paragraph(), paragraph(), paragraph('b') ]);

        expect(editor.getMarkdown()).toBe('a\n\n\nb');
        expect(blockShapes(parse('a\n\n\nb')))
            .toEqual([ 'paragraph|a', 'paragraph|', 'paragraph|', 'paragraph|b' ]);
    });

    it('keeps blank lines at the start and end of the file', () =>
    {
        expect(blockShapes(parse('\na'))).toEqual([ 'paragraph|', 'paragraph|a' ]);

        const editor = createEditor();
        setDoc(editor, [ paragraph(), paragraph('a'), paragraph() ]);

        const markdown = editor.getMarkdown();
        expect(markdown).toBe('\na\n\n');
        expect(blockShapes(parse(markdown))).toEqual([ 'paragraph|', 'paragraph|a', 'paragraph|' ]);
    });

    it('loads a legacy &nbsp; spacer as its real lines and heals it to blank lines on save', () =>
    {
        const editor = parse('p1\n\n&nbsp;\n\np2');

        expect(blockShapes(editor))
            .toEqual([ 'paragraph|p1', 'paragraph|', 'paragraph|', 'paragraph|', 'paragraph|p2' ]);
        expect(editor.getMarkdown()).toBe('p1\n\n\n\np2');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('line model: headings', () =>
{
    it('lets a heading and its paragraph touch on a single newline', () =>
    {
        const editor = createEditor();
        setDoc(editor, [ heading('H'), paragraph('b') ]);

        expect(editor.getMarkdown()).toBe('# H\nb');
        expect(blockShapes(parse('# H\nb'))).toEqual([ 'heading|H', 'paragraph|b' ]);
    });

    it('keeps the blank line between a heading and its paragraph as a real line', () =>
    {
        const editor = parse('# H\n\nb');

        expect(blockShapes(editor)).toEqual([ 'heading|H', 'paragraph|', 'paragraph|b' ]);
        expect(editor.getMarkdown()).toBe('# H\n\nb');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('line model: grammar terminators', () =>
{
    it('shows the blank line that ends a list and round-trips it exactly', () =>
    {
        const editor = parse('- a\n\nb');

        expect(blockShapes(editor)).toEqual([ 'bulletList|a', 'paragraph|', 'paragraph|b' ]);
        expect(editor.getMarkdown()).toBe('- a\n\nb');
    });

    it('writes the terminating blank line for a paragraph placed straight after a list', () =>
    {
        const editor = createEditor();
        setDoc(editor, [
            {
                type: 'bulletList',
                content: [ { type: 'listItem', content: [ paragraph('a') ] } ],
            },
            paragraph('b'),
        ]);

        expect(editor.getMarkdown()).toBe('- a\n\nb');
    });

    it('keeps blank lines after a table as real lines', () =>
    {
        const editor = parse('| a |\n| --- |\n| 1 |\n\n\nb');

        expect(blockShapes(editor)).toEqual([ 'table|a1', 'paragraph|', 'paragraph|', 'paragraph|b' ]);

        const markdown = editor.getMarkdown();
        const reloaded = parse(markdown);
        expect(blockShapes(reloaded)).toEqual([ 'table|a1', 'paragraph|', 'paragraph|', 'paragraph|b' ]);
        expect(reloaded.getMarkdown()).toBe(markdown);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('line model: container interiors', () =>
{
    // A document ending in a container gains one trailing blank line on first save: the trailing-node extension
    // keeps a real, clickable empty paragraph below the last quote/list/table, and the line model writes it as the
    // honest blank line it is. The canonical fixtures below carry it.
    it('keeps a blank line inside a blockquote as a real quoted line, without growth across saves', () =>
    {
        expect(parse('> a\n>\n> b').getMarkdown()).toBe('> a\n>\n> b\n\n');
        const editor = expectStable('> a\n>\n> b\n\n');

        expect(shapesAt(editor, 0)).toEqual([ 'paragraph|a', 'paragraph|', 'paragraph|b' ]);
    });

    it('keeps touching lines inside a blockquote touching', () =>
    {
        const editor = expectStable('> a\n> b\n\n');

        expect(shapesAt(editor, 0)).toEqual([ 'paragraph|a', 'paragraph|b' ]);
    });

    it('keeps a line typed under a blockquote outside the quote', () =>
    {
        const editor = parse('> a\nafter');

        expect(blockShapes(editor)).toEqual([ 'blockquote|a', 'paragraph|after' ]);
        expect(editor.getMarkdown()).toBe('> a\n\nafter');
        expectStable('> a\n\nafter');
    });

    it('keeps a blank line inside a list item as a real line, without growth across saves', () =>
    {
        const editor = expectStable('- a\n\n  b\n\n');

        expect(shapesAt(editor, 0, 0)).toEqual([ 'paragraph|a', 'paragraph|', 'paragraph|b' ]);
    });

    it('round-trips task items with their checkbox state', () =>
    {
        const editor = expectStable('- [x] done\n- [ ] pending\n\n');

        expect(shapesAt(editor, 0)).toEqual([ 'taskItem|done', 'taskItem|pending' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('line model: hard breaks', () =>
{
    it('serializes Shift+Enter as a plain newline, which reloads as touching paragraphs', () =>
    {
        const editor = createEditor();
        setDoc(editor, [
            {
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'a' },
                    { type: 'hardBreak' },
                    { type: 'text', text: 'b' },
                ],
            },
        ]);

        const markdown = editor.getMarkdown();
        expect(markdown).toBe('a\nb');
        expect(blockShapes(parse(markdown))).toEqual([ 'paragraph|a', 'paragraph|b' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
