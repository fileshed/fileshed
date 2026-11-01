//----------------------------------------------------------------------------------------------------------------------
// Markdown Frontmatter — splitting the YAML block off the body and putting it back
//
// The contract: a file whose first line is `---` and that has a later `---` line opens with frontmatter; the YAML
// between the fences, the fences themselves, and the one conventional blank line after the closing fence form the
// head, and the rest is the body. Replacing either part writes the other back byte for byte. The WYSIWYG surface sees
// only the body, so an edit there can never reach the frontmatter -- exercised through a real TipTap editor with the
// line-model stack, because that round trip is what used to turn the block into a horizontal rule and a heading.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '@tiptap/core';
import { TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
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
    MarkdownTaskItem,
    lineModelMarked,
} from '@client/engines/markdown/lineModel.ts';

// Under test
import { replaceBody, replaceFrontmatter, splitFrontmatter } from '@client/engines/markdown/frontmatter.ts';

//----------------------------------------------------------------------------------------------------------------------

let editors : Editor[] = [];

function parse(markdown : string) : Editor
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
    editor.commands.setContent(markdown, { contentType: 'markdown' });

    editors.push(editor);
    return editor;
}

// What the markdown editor does on a WYSIWYG edit: the body goes in, the edit happens, the serialization goes back
// on behind the file's head.
function editInPreview(file : string, edit : (editor : Editor) => void) : string
{
    const editor = parse(splitFrontmatter(file).body);
    edit(editor);

    return replaceBody(file, editor.getMarkdown());
}

function typeAtStart(text : string) : (editor : Editor) => void
{
    return (editor) => { editor.commands.insertContentAt(1, text); };
}

afterEach(() =>
{
    editors.forEach((editor) => editor.destroy());
    editors = [];
});

//----------------------------------------------------------------------------------------------------------------------
// Split
//----------------------------------------------------------------------------------------------------------------------

describe('splitFrontmatter', () =>
{
    it('reads the YAML between the fences and leaves the body after the conventional blank line', () =>
    {
        const split = splitFrontmatter('---\ntitle: Hello World\ntags: [a, b]\n---\n\n# Body');

        expect(split.frontmatter?.yaml).toBe('title: Hello World\ntags: [a, b]\n');
        expect(split.body).toBe('# Body');
    });

    it('treats a file that does not open with a fence as all body', () =>
    {
        const text = '# Title\n\n---\nnot: frontmatter\n---\n';

        expect(splitFrontmatter(text)).toEqual({ frontmatter: null, body: text });
    });

    it('treats an opening fence with no closing fence as all body', () =>
    {
        const text = '---\ntitle: never closed\n\n# Body';

        expect(splitFrontmatter(text)).toEqual({ frontmatter: null, body: text });
    });

    it('lets the body start directly under the closing fence when there is no blank line', () =>
    {
        const split = splitFrontmatter('---\na: 1\n---\n# Body');

        expect(split.frontmatter?.gap).toBe('');
        expect(split.body).toBe('# Body');
    });

    it('takes only one blank line as the separator, leaving any others in the body', () =>
    {
        const split = splitFrontmatter('---\na: 1\n---\n\n\n# Body');

        expect(split.body).toBe('\n# Body');
    });

    it('reads an empty block as empty YAML', () =>
    {
        const split = splitFrontmatter('---\n---\n\nBody');

        expect(split.frontmatter?.yaml).toBe('');
        expect(split.body).toBe('Body');
    });

    it('reads a closing fence on the last line, with no line terminator, as frontmatter with an empty body', () =>
    {
        const split = splitFrontmatter('---\na: 1\n---');

        expect(split.frontmatter?.yaml).toBe('a: 1\n');
        expect(split.body).toBe('');
    });

    it('decides on the fences alone, so a blank first line or a block that is not YAML still opens frontmatter', () =>
    {
        const split = splitFrontmatter('---\n\nNote: back up first\n\n---\nbar\n');

        expect(split.frontmatter?.yaml).toBe('\nNote: back up first\n\n');
        expect(split.body).toBe('bar\n');
        expect(splitFrontmatter('---\nnot: [yaml\n---\nBody').body).toBe('Body');
    });

    it('accepts fences with trailing spaces and CRLF line endings, but not four dashes', () =>
    {
        expect(splitFrontmatter('---  \r\na: 1\r\n---\r\n\r\nBody').body).toBe('Body');
        expect(splitFrontmatter('----\na: 1\n----\n').frontmatter).toBeNull();
    });

    it('always splits losslessly: fence, gap, and body rebuild the file exactly', () =>
    {
        const files = [
            '---\ntitle: x\n---\n\n# Body\n',
            '---\n# a comment\nkey: "quoted"\n---\nBody',
            '---\ninvalid: [yaml\n---\n\n\nBody',
            '---\r\na: 1\r\n---\r\n\r\nBody',
            '---\n---\n',
        ];

        for(const file of files)
        {
            const { frontmatter, body } = splitFrontmatter(file);
            expect(`${ frontmatter?.fence ?? '' }${ frontmatter?.gap ?? '' }${ body }`).toBe(file);
        }
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Replace
//----------------------------------------------------------------------------------------------------------------------

describe('replaceBody', () =>
{
    it('writes the frontmatter back byte for byte, comments, odd spacing, and invalid YAML included', () =>
    {
        const head = '---   \n# keep me\ntitle:    \'Spaced\'\nbroken: [yaml\n---\n\n';

        expect(replaceBody(`${ head }old body`, 'new body')).toBe(`${ head }new body`);
    });

    it('returns the body alone for a file without frontmatter', () =>
    {
        expect(replaceBody('# Old', '# New')).toBe('# New');
    });

    it('keeps a file that had no blank line under the fence without one', () =>
    {
        expect(replaceBody('---\na: 1\n---\nold', 'new')).toBe('---\na: 1\n---\nnew');
    });

    it('separates text typed under bare frontmatter with the conventional blank line', () =>
    {
        expect(replaceBody('---\na: 1\n---\n', 'Hello')).toBe('---\na: 1\n---\n\nHello');
        expect(replaceBody('---\na: 1\n---', 'Hello')).toBe('---\na: 1\n---\n\nHello');
    });

    it('keeps the frontmatter when the body is cleared', () =>
    {
        expect(replaceBody('---\na: 1\n---\n\nBody', '')).toBe('---\na: 1\n---\n\n');
    });
});

describe('replaceFrontmatter', () =>
{
    it('replaces the YAML and keeps the body and its separation', () =>
    {
        expect(replaceFrontmatter('---\na: 1\n---\n\n# Body', 'a: 2\n')).toBe('---\na: 2\n---\n\n# Body');
        expect(replaceFrontmatter('---\na: 1\n---\n# Body', 'a: 2\n')).toBe('---\na: 2\n---\n# Body');
    });

    it('adds a block in front of a file without one, with the conventional blank line', () =>
    {
        expect(replaceFrontmatter('# Body', 'title: New\n')).toBe('---\ntitle: New\n---\n\n# Body');
    });

    it('terminates YAML that lacks a final newline before closing the fence', () =>
    {
        expect(replaceFrontmatter('', 'title: New')).toBe('---\ntitle: New\n---\n');
    });

    it('removes the block entirely when the YAML is blank', () =>
    {
        expect(replaceFrontmatter('---\na: 1\n---\n\n# Body', '')).toBe('# Body');
        expect(replaceFrontmatter('---\na: 1\n---\n\n# Body', '  \n')).toBe('# Body');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Round trip through the WYSIWYG surface
//----------------------------------------------------------------------------------------------------------------------

describe('frontmatter through a WYSIWYG edit', () =>
{
    it('keeps the frontmatter intact when the body is edited', () =>
    {
        const file = '---\ntitle: Hello World\ntags: [a, b]\n---\n\n# Body\nText';

        const saved = editInPreview(file, typeAtStart('Edited '));

        expect(saved).toBe('---\ntitle: Hello World\ntags: [a, b]\n---\n\n# Edited Body\nText');
    });

    it('opens the body on its first real block, not on an empty paragraph for the separator', () =>
    {
        const editor = parse(splitFrontmatter('---\ntitle: x\n---\n\n# Body\nText').body);

        expect(editor.getJSON().content?.[0]?.type).toBe('heading');
    });

    it('is a fixed point over repeated parse and save cycles', () =>
    {
        const files = [
            '---\ntitle: x\n---\n\n# Body\nText\n\nMore',
            '---\na: 1\n---\nDirectly under',
            '---\ninvalid: [yaml\n---\n\n\nAfter a blank line',
            '---\ntitle: x\n---\n\n',
        ];

        for(const file of files)
        {
            let current = file;
            for(let cycle = 0; cycle < 3; cycle++)
            {
                current = replaceBody(current, parse(splitFrontmatter(current).body).getMarkdown());
                expect(current).toBe(file);
            }
        }
    });

    it('gives text typed into a frontmatter-only file the conventional blank line', () =>
    {
        expect(editInPreview('---\ntitle: x\n---\n', typeAtStart('Hello'))).toBe('---\ntitle: x\n---\n\nHello');
    });
});

//----------------------------------------------------------------------------------------------------------------------
