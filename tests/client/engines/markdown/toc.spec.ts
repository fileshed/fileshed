//----------------------------------------------------------------------------------------------------------------------
// Markdown Table of Contents — the marker line
//
// The contract: a line holding only `[TOC]`, `[[toc]]`, `[[TOC]]` or `[[_TOC_]]` is a table of contents, and the file
// keeps the marker as written. A marker with anything else on its line is text. Typing a marker on a line of its own
// in Preview makes a table of contents.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

// Under test
import { TableOfContents, isTOCMarker } from '@client/engines/markdown/toc.ts';

// Support
import { closeEditors, openMarkdown, topBlocks, typeText } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('TableOfContents', () =>
{
    afterEach(() => { closeEditors(); });

    it('reads each marker spelling on a line of its own as a table of contents, and writes it back as spelled', () =>
    {
        for(const marker of [ '[TOC]', '[[toc]]', '[[TOC]]', '[[_TOC_]]' ])
        {
            const editor = openMarkdown(`${ marker }\n# Heading`, [ TableOfContents ]);

            expect(topBlocks(editor)[0]).toBe(`tableOfContents|${ marker }`);
            expect(editor.getMarkdown()).toBe(`${ marker }\n# Heading`);
        }
    });

    it('leaves a marker that shares its line with other text as text', () =>
    {
        expect(topBlocks(openMarkdown('See [TOC] here', [ TableOfContents ]))).toEqual([ 'paragraph|See [TOC] here' ]);
    });

    it('leaves the lines of a paragraph with brackets in them as they are, under either line rule', () =>
    {
        const markdown = 'a [link](x) b\nOne\n[link](y) two';

        const lineModel = openMarkdown(markdown, [ TableOfContents ]);
        const strict = openMarkdown(markdown, [ TableOfContents ], true);

        expect(topBlocks(lineModel)).toEqual([ 'paragraph|a link b', 'paragraph|One', 'paragraph|link two' ]);
        expect(lineModel.getMarkdown()).toBe(markdown);
        expect(topBlocks(strict)).toEqual([ 'paragraph|a link b\nOne\nlink two' ]);
        expect(strict.getMarkdown()).toBe(markdown);
    });

    it('makes a table of contents of a marker typed on a line of its own', () =>
    {
        const editor = openMarkdown('Intro\n\nEnd', [ TableOfContents ]);
        editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 1);

        typeText(editor, '[TOC]');

        expect(topBlocks(editor)).toEqual([ 'paragraph|Intro', 'tableOfContents|[TOC]', 'paragraph|End' ]);
        expect(editor.getMarkdown()).toBe('Intro\n[TOC]\nEnd');
    });

    it('leaves a marker typed into a line that already holds text as text', () =>
    {
        const editor = openMarkdown('Intro', [ TableOfContents ]);
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);

        typeText(editor, ' [TOC]');

        expect(topBlocks(editor)).toEqual([ 'paragraph|Intro [TOC]' ]);
    });
});

describe('isTOCMarker', () =>
{
    it('accepts a marker with trailing spaces and turns away one with other text', () =>
    {
        expect(isTOCMarker('[[_TOC_]]  ')).toBe(true);
        expect(isTOCMarker('[TOC] and more')).toBe(false);
        expect(isTOCMarker('[toc]')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
