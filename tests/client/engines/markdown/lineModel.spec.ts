//----------------------------------------------------------------------------------------------------------------------
// Markdown Line Model — every visual line is a real line in the file
//
// The contract: blocks join on single newlines, so consecutive paragraphs touch ("a\nb"); a blank line is a real
// empty paragraph, one per blank line ("a\n\nb" is [a, empty, b]); and the mapping is stable across serialize and
// reload. Lists, quotes, and tables lazily swallow a directly-following line (markdown grammar), so the serializer
// writes their terminating blank line itself; a divider directly under a text line would underline it into a heading,
// so the serializer writes a blank line before it. With strict line breaks, touching lines are one paragraph that keeps
// its newlines, drawn as spaces; the blank line that ends a paragraph is its end, drawn as space below it, every other
// blank line is still a real line, and Shift+Enter writes a backslash line break. Exercised through a real TipTap
// editor with the same extension stack the component wires up, because the round-trip is the contract.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import { Editor, type JSONContent } from '@tiptap/core';
import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
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
    MarkdownTable,
    MarkdownTaskItem,
    MarkdownTaskList,
    StrictParagraphs,
    lineModelMarked,
    strictLineModelMarked,
} from '@client/engines/markdown/lineModel.ts';

//----------------------------------------------------------------------------------------------------------------------

let editors : Editor[] = [];

function createEditor(strictLineBreaks = false) : Editor
{
    const editor = new Editor({
        element: document.createElement('div'),
        extensions: [
            Markdown.configure({ marked: strictLineBreaks ? strictLineModelMarked : lineModelMarked }),
            StarterKit.configure({
                document: false,
                paragraph: false,
                hardBreak: false,
                blockquote: false,
                listItem: false,
            }),
            MarkdownDocument.configure({ strictLineBreaks }),
            MarkdownBlockquote.configure({ strictLineBreaks }),
            MarkdownListItem.configure({ strictLineBreaks }),
            MarkdownParagraph,
            MarkdownHardBreak.configure({ strictLineBreaks }),
            MarkdownTaskList,
            MarkdownTaskItem.configure({ nested: true, strictLineBreaks }),
            BlankLines,
            MarkdownTable,
            TableRow,
            TableHeader,
            TableCell,
            ...strictLineBreaks ? [ StrictParagraphs ] : [],
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

function parse(markdown : string, strictLineBreaks = false) : Editor
{
    const editor = createEditor(strictLineBreaks);
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
    let nodes : JSONContent[] = editor.getJSON().content ?? [];
    for(const index of path) { nodes = nodes[index]?.content ?? []; }

    return nodes.map((node) => `${ node.type }|${ flatText(node) }`);
}

// The core line-model guarantee: serializing what was parsed reproduces the input byte-for-byte, and stays a fixed
// point over repeated save/reload cycles -- growth on any cycle is the corruption this spec exists to prevent.
function expectStable(markdown : string, strictLineBreaks = false) : Editor
{
    const first = parse(markdown, strictLineBreaks);
    expect(first.getMarkdown()).toBe(markdown);

    let current = markdown;
    for(let cycle = 0; cycle < 3; cycle++)
    {
        const editor = parse(current, strictLineBreaks);
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

    it('writes a blank line before a divider placed straight under a text line, so it reloads as a divider', () =>
    {
        const editor = createEditor();
        setDoc(editor, [ paragraph('a'), { type: 'horizontalRule' }, paragraph('b') ]);

        const markdown = editor.getMarkdown();
        expect(markdown).toBe('a\n\n---\nb');
        expect(blockShapes(parse(markdown)))
            .toEqual([ 'paragraph|a', 'paragraph|', 'horizontalRule|', 'paragraph|b' ]);
    });

    it('writes a divider under a heading or a blank line with nothing added', () =>
    {
        const editor = createEditor();
        setDoc(editor, [
            heading('H'),
            { type: 'horizontalRule' },
            paragraph('a'),
            paragraph(),
            { type: 'horizontalRule' },
            paragraph('b'),
        ]);

        expect(editor.getMarkdown()).toBe('# H\n---\na\n\n---\nb');
        expectStable('# H\n---\na\n\n---\nb');
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

    it('keeps blank lines before a task list as real lines, as before any other list', () =>
    {
        const editor = expectStable('a\n\n- [ ] task\n\nb');

        expect(blockShapes(editor))
            .toEqual([ 'paragraph|a', 'paragraph|', 'taskList|task', 'paragraph|', 'paragraph|b' ]);
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

describe('line model: strict line breaks', () =>
{
    it('reads touching lines as one paragraph that keeps its newlines, and writes them back as they were', () =>
    {
        const editor = expectStable('First line\nsecond line', true);

        expect(blockShapes(editor)).toEqual([ 'paragraph|First line\nsecond line' ]);
    });

    it('reads the blank line that ends a paragraph as the end of it, and each further blank line as a real line', () =>
    {
        expect(blockShapes(expectStable('a\n\nb', true))).toEqual([ 'paragraph|a', 'paragraph|b' ]);
        expect(blockShapes(expectStable('a\n\n\nb', true))).toEqual([ 'paragraph|a', 'paragraph|', 'paragraph|b' ]);
    });

    it('keeps a blank line that ends no paragraph as a real line', () =>
    {
        expect(blockShapes(expectStable('# Title\n\nText', true)))
            .toEqual([ 'heading|Title', 'paragraph|', 'paragraph|Text' ]);
    });

    it('writes a blank line after each paragraph made in Preview, so paragraphs and empty lines stay as made', () =>
    {
        const cases = [
            [ paragraph('a'), paragraph('b') ],
            [ paragraph('a'), paragraph(), paragraph('b') ],
            [ paragraph('a'), paragraph() ],
            [ heading('Title'), paragraph('a'), paragraph('b') ],
        ];

        for(const blocks of cases)
        {
            const editor = createEditor(true);
            setDoc(editor, blocks);

            expect(parse(editor.getMarkdown(), true).getJSON().content).toEqual(blocks);
        }
    });

    it('reads the paragraphs inside a quote and a list item as it does the document\'s', () =>
    {
        expect(shapesAt(expectStable('> a\n> b\n>\n> c\n\n', true), 0)).toEqual([ 'paragraph|a\nb', 'paragraph|c' ]);
        expect(shapesAt(expectStable('- a\n  b\n\n', true), 0, 0)).toEqual([ 'paragraph|a\nb' ]);
        expect(shapesAt(expectStable('- a\n\n  b\n\n', true), 0, 0)).toEqual([ 'paragraph|a', 'paragraph|b' ]);
    });

    it('writes Shift+Enter as a backslash at the end of the line, which reloads as the same line break', () =>
    {
        const editor = createEditor(true);
        const blocks = [
            {
                type: 'paragraph',
                content: [
                    { type: 'text', text: 'a' },
                    { type: 'hardBreak' },
                    { type: 'text', text: 'b' },
                ],
            },
        ];
        setDoc(editor, blocks);

        const markdown = editor.getMarkdown();
        expect(markdown).toBe('a\\\nb');
        expect(parse(markdown, true).getJSON().content).toEqual(blocks);
    });

    it('draws a paragraph\'s newlines as collapsible spaces, and leaves a code block\'s alone', () =>
    {
        const editor = parse('First line\nsecond line\n\n```\ncode\nmore\n```', true);

        const drawn = [ ...editor.view.dom.querySelectorAll('.md-soft-break') ].map((span) => span.textContent);

        expect(drawn).toEqual([ '\n' ]);
        expect(editor.view.dom.querySelector('pre .md-soft-break')).toBeNull();
    });

    it('marks each paragraph with a block after it as ending on a blank line, and no other', () =>
    {
        const editor = parse('a\n\n\nb\n\nc', true);

        const ending = [ ...editor.view.dom.querySelectorAll('.md-paragraph-end') ];

        expect(ending.map((element) => element.textContent)).toEqual([ 'a', 'b' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('line model: long files', () =>
{
    // Sections of every block kind whose tokenizers run at each block: text, lists, task lists, and tables.
    function sections(count : number) : string
    {
        return Array.from({ length: count }, (_, index) =>
        {
            return [
                `## Section ${ index }`,
                `Text with __bold__ and a [link](https://example.com/${ index }).`,
                '',
                `- item ${ index }`,
                `- [ ] task ${ index }`,
                '',
                '| a | b |',
                '| --- | --- |',
                `| ${ index } | x |`,
                '',
            ];
        }).flat()
            .join('\n');
    }

    function fastestParse(markdown : string) : number
    {
        const manager = createEditor().markdown;
        if(!manager) { throw new Error('the markdown extension is missing'); }

        manager.parse(markdown);
        const times = Array.from({ length: 3 }, () =>
        {
            const started = performance.now();
            manager.parse(markdown);
            return performance.now() - started;
        });

        return Math.min(...times);
    }

    // Eight times the file takes about eight times as long; a parse quadratic in the file's length takes sixty-four.
    it('parses a long file in time proportional to its length', () =>
    {
        const short = fastestParse(sections(250));
        const long = fastestParse(sections(2000));

        expect(long).toBeLessThan(short * 24);
    });
});

//----------------------------------------------------------------------------------------------------------------------
