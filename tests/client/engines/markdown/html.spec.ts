//----------------------------------------------------------------------------------------------------------------------
// Markdown HTML — HTML blocks and inline pieces
//
// The contract: an HTML block parses into one node holding its source, and an inline piece into one atom: an element
// from its opening tag through the closing tag that balances it, or a tag on its own. Both write their source back
// unchanged, comments stay out of them, and a line typed directly under an HTML block that would absorb it gets a
// blank line between. Driven through the real line-model stack, whose parse and serialization are what must agree.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import { Editor, type JSONContent } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

// Engines
import {
    BlankLines,
    MarkdownBlockquote,
    MarkdownDocument,
    MarkdownHardBreak,
    MarkdownListItem,
    MarkdownParagraph,
    lineModelMarked,
} from '@client/engines/markdown/lineModel.ts';

// Under test
import { HtmlBlock, HtmlInline } from '@client/engines/markdown/html.ts';

//----------------------------------------------------------------------------------------------------------------------

let editors : Editor[] = [];

function open(markdown : string) : Editor
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
            BlankLines,
            HtmlBlock,
            HtmlInline,
        ],
    });
    editor.commands.setContent(markdown, { contentType: 'markdown' });

    editors.push(editor);
    return editor;
}

// Each top-level block as `type|text`, an HTML block's text being its source.
function blocks(editor : Editor) : string[]
{
    const content : JSONContent[] = editor.getJSON().content ?? [];

    return content.map((block) =>
    {
        return `${ block.type ?? '' }|${ (block.content ?? []).map((child) => child.text ?? '').join('') }`;
    });
}

function inlineSources(editor : Editor) : string[]
{
    const sources : string[] = [];
    editor.state.doc.descendants((node) =>
    {
        if(node.type.name === 'htmlInline') { sources.push(node.attrs.source as string); }
    });

    return sources;
}

function htmlNodeCount(editor : Editor) : number
{
    let count = 0;
    editor.state.doc.descendants((node) =>
    {
        if(node.type.name === 'htmlBlock' || node.type.name === 'htmlInline') { count += 1; }
    });

    return count;
}

afterEach(() =>
{
    editors.forEach((editor) => editor.destroy());
    editors = [];
});

//----------------------------------------------------------------------------------------------------------------------

describe('HtmlBlock', () =>
{
    it('holds an HTML block as its source and writes it back unchanged', () =>
    {
        const source = '<div align="center">\n  <b>Hi</b>\n</div>';
        const file = `${ source }\n\nAfter`;

        const editor = open(file);

        expect(blocks(editor)).toEqual([ `htmlBlock|${ source }`, 'paragraph|', 'paragraph|After' ]);
        expect(editor.getMarkdown()).toBe(file);
    });

    it('keeps the blank lines around an HTML block as real lines', () =>
    {
        const file = 'Intro\n\n<div>x</div>\n\nAfter';

        const editor = open(file);

        expect(blocks(editor)).toEqual([
            'paragraph|Intro',
            'paragraph|',
            'htmlBlock|<div>x</div>',
            'paragraph|',
            'paragraph|After',
        ]);
        expect(editor.getMarkdown()).toBe(file);
    });

    it('writes a blank line between an HTML block and a line typed directly under it', () =>
    {
        const doc : JSONContent = {
            type: 'doc',
            content: [
                { type: 'htmlBlock', content: [ { type: 'text', text: '<div>x</div>' } ] },
                { type: 'paragraph', content: [ { type: 'text', text: 'Typed' } ] },
            ],
        };

        const editor = open('');
        editor.commands.setContent(doc);

        const written = editor.getMarkdown();

        expect(written).toBe('<div>x</div>\n\nTyped');
        expect(blocks(open(written))).toEqual([ 'htmlBlock|<div>x</div>', 'paragraph|', 'paragraph|Typed' ]);
    });

    it('writes no blank line under an HTML block that ends at its own closing tag', () =>
    {
        const file = '<pre>\nx\n</pre>\nAfter';

        const editor = open(file);

        expect(blocks(editor)).toEqual([ 'htmlBlock|<pre>\nx\n</pre>', 'paragraph|After' ]);
        expect(editor.getMarkdown()).toBe(file);
    });

    it('leaves a comment out of the HTML blocks', () =>
    {
        expect(htmlNodeCount(open('<!-- a note -->\n\nText'))).toBe(0);
    });

    it('reads a long line of comments whose last one is left open as HTML, without stalling on it', () =>
    {
        const line = `<!--${ '--><!--'.repeat(60) }x`;

        const started = performance.now();
        const editor = open(line);

        expect(blocks(editor)[0]).toBe(`htmlBlock|${ line }`);
        expect(performance.now() - started).toBeLessThan(1000);
    });
});

describe('HtmlInline', () =>
{
    it('keeps an element whole, from its opening tag through its closing tag, and writes it back unchanged', () =>
    {
        const file = 'Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy';

        const editor = open(file);

        expect(inlineSources(editor)).toEqual([ '<kbd>Ctrl</kbd>', '<kbd>C</kbd>' ]);
        expect(editor.getMarkdown()).toBe(file);
    });

    it('keeps a void element, a self-closing tag, and a tag with no partner on its line as pieces of their own', () =>
    {
        const file = 'a<br>b <img src="x.png" alt="x"/> and <span class="open">rest';

        const editor = open(file);

        expect(inlineSources(editor)).toEqual([ '<br>', '<img src="x.png" alt="x"/>', '<span class="open">' ]);
        expect(editor.getMarkdown()).toBe(file);
    });

    it('balances an element against nested elements of the same name', () =>
    {
        const editor = open('x <span>a <span>b</span> c</span> y');

        expect(inlineSources(editor)).toEqual([ '<span>a <span>b</span> c</span>' ]);
    });

    it('reads angle brackets that are not tags as text, and leaves comments and autolinks alone', () =>
    {
        const editor = open('a < b, 1 <2, <https://example.com>, and <!-- note --> here');

        expect(htmlNodeCount(editor)).toBe(0);
    });
});

//----------------------------------------------------------------------------------------------------------------------
