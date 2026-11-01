//----------------------------------------------------------------------------------------------------------------------
// Markdown Outline — the headings the sidebar lists, and the section a position falls in
//
// The contract: the document's top-level headings in order, each with its level, its text, and a position that
// addresses the heading node itself. Headings inside quotes or lists and headings with no text are left out. A
// position belongs to the last heading at or before it, and a position above the first heading belongs to none.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

// Under test
import { type OutlineEntry, buildOutline, findActiveEntry } from '@client/engines/markdown/outline.ts';

//----------------------------------------------------------------------------------------------------------------------

let editor : Editor | null = null;

function parse(markdown : string) : Editor
{
    editor = new Editor({
        element: document.createElement('div'),
        content: markdown,
        contentType: 'markdown',
        extensions: [ StarterKit, Markdown ],
    });

    return editor;
}

afterEach(() =>
{
    editor?.destroy();
    editor = null;
});

//----------------------------------------------------------------------------------------------------------------------

describe('buildOutline', () =>
{
    it('lists the top-level headings in document order with their levels', () =>
    {
        const { state } = parse('# Intro\n\nText\n\n## Setup\n\n### Details\n\n## Usage\n');

        const outline = buildOutline(state.doc).map(({ level, text }) => ({ level, text }));

        expect(outline).toEqual([
            { level: 1, text: 'Intro' },
            { level: 2, text: 'Setup' },
            { level: 3, text: 'Details' },
            { level: 2, text: 'Usage' },
        ]);
    });

    it('positions each entry on its heading node', () =>
    {
        const { state } = parse('Text\n\n## Setup\n');

        const [ entry ] = buildOutline(state.doc);

        expect(entry && state.doc.nodeAt(entry.pos)?.textContent).toBe('Setup');
    });

    it('leaves out headings inside a quote and headings with no text', () =>
    {
        const { state } = parse('# Kept\n\n> ## Quoted\n\n#\n');

        expect(buildOutline(state.doc).map((entry) => entry.text)).toEqual([ 'Kept' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('findActiveEntry', () =>
{
    const outline : OutlineEntry[] = [
        { level: 1, text: 'Intro', pos: 10 },
        { level: 2, text: 'Setup', pos: 40 },
        { level: 2, text: 'Usage', pos: 90 },
    ];

    it('places a position in the last heading at or before it', () =>
    {
        expect(findActiveEntry(outline, 40)?.text).toBe('Setup');
        expect(findActiveEntry(outline, 89)?.text).toBe('Setup');
        expect(findActiveEntry(outline, 500)?.text).toBe('Usage');
    });

    it('places a position above the first heading in no section', () =>
    {
        expect(findActiveEntry(outline, 3)).toBeNull();
        expect(findActiveEntry([], 3)).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
