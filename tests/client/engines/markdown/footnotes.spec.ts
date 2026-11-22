//----------------------------------------------------------------------------------------------------------------------
// Markdown Footnotes — references, definitions, and where Preview draws them
//
// The contract: references are numbered in the order of their first use, and only when their label has a definition.
// A definition runs on through its indented lines, and the file keeps references and definitions as written and where
// written; with strict line breaks, a definition's paragraphs read as the document's do. Preview draws each top-level
// definition at the end of the page in its reference's order, under a divider, and choosing a reference goes to its
// definition. A new footnote takes the first free number and puts its definition at the end of the document after a
// blank line.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import type { Editor } from '@tiptap/core';

// Under test
import {
    FootnoteDefinition,
    FootnoteDisplay,
    FootnoteReference,
    matchFootnoteDefinition,
    numberFootnotes,
} from '@client/engines/markdown/footnotes.ts';

// Support
import { closeEditors, openMarkdown, topBlocks } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const extensions = [ FootnoteReference, FootnoteDefinition, FootnoteDisplay ];

function open(markdown : string) : Editor
{
    return openMarkdown(markdown, extensions);
}

function definitionElement(editor : Editor, label : string) : HTMLElement
{
    const element = editor.view.dom.querySelector(`[data-footnote-definition][data-label="${ label }"]`);
    if(!(element instanceof HTMLElement)) { throw new Error(`no definition for ${ label }`); }

    return element;
}

//----------------------------------------------------------------------------------------------------------------------

describe('numberFootnotes', () =>
{
    it('numbers labels by their first reference, skipping references with no definition', () =>
    {
        const numbers = numberFootnotes([ 'b', 'missing', 'a', 'b' ], [ 'a', 'b', 'unused' ]);

        expect([ ...numbers ]).toEqual([ [ 'b', 1 ], [ 'a', 2 ] ]);
    });
});

describe('matchFootnoteDefinition', () =>
{
    it('takes the indented lines under a definition and the blank lines between them, not the ones after', () =>
    {
        const match = matchFootnoteDefinition('[^1]: First\n    second\n\n    third\n\nNext paragraph');

        expect(match).toEqual({
            raw: '[^1]: First\n    second\n\n    third',
            label: '1',
            content: 'First\nsecond\n\nthird',
        });
    });

    it('ends a definition at the first line that is not indented', () =>
    {
        expect(matchFootnoteDefinition('[^a]: Note\nNot part of it')?.raw).toBe('[^a]: Note');
    });

    it('turns away a line that is not a definition', () =>
    {
        expect(matchFootnoteDefinition('[^a] no colon')).toBeNull();
        expect(matchFootnoteDefinition('[^two words]: no')).toBeNull();
    });
});

describe('Footnote markdown', () =>
{
    afterEach(() => { closeEditors(); });

    it('writes references and definitions back as written, consecutive definitions on consecutive lines', () =>
    {
        const markdown = 'One[^1] and two[^note].\n\n'
            + '[^1]: The first.\n[^note]: The second\n    on two lines.\n\nAfter.';

        expect(open(markdown).getMarkdown()).toBe(markdown);
    });

    it('leaves the lines of a paragraph with references in them as they are, under either line rule', () =>
    {
        const markdown = 'a [^1] b\nOne\n[^1] two';
        const strictExtensions = [ FootnoteReference, FootnoteDefinition.configure({ strictLineBreaks: true }) ];

        const lineModel = open(markdown);
        const strict = openMarkdown(markdown, strictExtensions, true);

        expect(topBlocks(lineModel)).toEqual([ 'paragraph|a  b', 'paragraph|One', 'paragraph| two' ]);
        expect(lineModel.getMarkdown()).toBe(markdown);
        expect(topBlocks(strict)).toEqual([ 'paragraph|a  b\nOne\n two' ]);
        expect(strict.getMarkdown()).toBe(markdown);
    });

    it('writes a blank line between a definition and a line added directly under it', () =>
    {
        const editor = open('[^1]: The note.');
        editor.commands.insertContentAt(editor.state.doc.content.size, {
            type: 'paragraph',
            content: [ { type: 'text', text: 'New line' } ],
        });

        expect(editor.getMarkdown()).toBe('[^1]: The note.\n\nNew line');
    });

    it('keeps a definition\'s paragraphs apart, and its touching lines together, with strict line breaks', () =>
    {
        const markdown = '[^1]: The first\n    paragraph.\n\n    The second.';
        const strictExtensions = [ FootnoteReference, FootnoteDefinition.configure({ strictLineBreaks: true }) ];

        const editor = openMarkdown(markdown, strictExtensions, true);

        expect(editor.state.doc.child(0).childCount).toBe(2);
        expect(editor.getMarkdown()).toBe(markdown);
    });
});

describe('FootnoteDisplay', () =>
{
    afterEach(() => { closeEditors(); });

    it('numbers each reference by its label\'s first use, and leaves one without a definition unnumbered', () =>
    {
        const editor = open('A[^x] B[^y] C[^x] D[^none]\n\n[^y]: Why.\n[^x]: Ex.');
        const numbers = [ ...editor.view.dom.querySelectorAll('[data-footnote-ref]') ]
            .map((reference) => reference.getAttribute('data-number'));

        expect(numbers).toEqual([ '1', '2', '1', null ]);
    });

    it('orders the top-level definitions by number at the end of the page, with the divider over the first drawn', () =>
    {
        const editor = open('A[^x] B[^y]\n\n[^y]: Why.\n[^x]: Ex.\n[^z]: Unreferenced.\n\nAfter.');

        expect(definitionElement(editor, 'x').style.order).toBe('1');
        expect(definitionElement(editor, 'y').style.order).toBe('2');
        expect(definitionElement(editor, 'z').style.order).toBe('3');
        expect(definitionElement(editor, 'x').classList.contains('md-footnotes-start')).toBe(true);
        expect(definitionElement(editor, 'y').classList.contains('md-footnotes-start')).toBe(false);
    });

    it('puts the cursor in a reference\'s definition when the reference is chosen', () =>
    {
        const editor = open('See[^1] here.\n\n[^1]: The note.');
        let referencePos = -1;
        editor.state.doc.descendants((node, pos) =>
        {
            if(node.type.name === 'footnoteReference') { referencePos = pos; }
        });
        const reference = editor.state.doc.nodeAt(referencePos);

        const click = new MouseEvent('click');
        const handled = editor.view.someProp('handleClickOn', (handle) =>
        {
            return reference ? handle(editor.view, referencePos, reference, referencePos, click, true) : false;
        });

        const $cursor = editor.state.doc.resolve(editor.state.selection.from);
        expect(handled).toBe(true);
        expect($cursor.node(1).type.name).toBe('footnoteDefinition');
    });
});

describe('insertFootnote', () =>
{
    afterEach(() => { closeEditors(); });

    it('inserts a reference with the first free number and its definition at the end after a blank line', () =>
    {
        const editor = open('Text[^1]\n\n[^1]: First.\n\nMore text');
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);

        editor.commands.insertFootnote();

        expect(editor.getMarkdown()).toBe('Text[^1]\n\n[^1]: First.\n\nMore text[^2]\n\n[^2]:');
        const $cursor = editor.state.doc.resolve(editor.state.selection.from);
        expect($cursor.node(1).type.name).toBe('footnoteDefinition');
        expect($cursor.node(1).attrs.label).toBe('2');
    });

    it('needs no blank line before the definition when the document already ends with one', () =>
    {
        const editor = open('Text\n\n');
        editor.commands.setTextSelection(5);

        editor.commands.insertFootnote();

        expect(topBlocks(editor).slice(-2)).toEqual([ 'paragraph|', 'footnoteDefinition|' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
