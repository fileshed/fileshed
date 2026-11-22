//----------------------------------------------------------------------------------------------------------------------
// Markdown Callouts — the marker line
//
// The contract: a quote whose first line is `[!type]` is a callout. GitHub's five types are their own kinds, Obsidian's
// other types and aliases are recognised, and a type neither knows is a note. An optional fold marker and title follow
// the type; without a title the type names the callout. The marker line stays text in the file, unescaped, and Preview
// hides the marker while the cursor is off that line.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

// Under test
import { CalloutMarkers, parseCalloutHeader } from '@client/engines/markdown/callouts.ts';

// Support
import { closeEditors, openMarkdown } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('parseCalloutHeader', () =>
{
    it('reads GitHub\'s five types in any case, IMPORTANT and CAUTION included as kinds of their own', () =>
    {
        const kinds = [ '[!NOTE]', '[!Tip]', '[!important]', '[!WARNING]', '[!caution]' ]
            .map((line) => parseCalloutHeader(line)?.kind);

        expect(kinds).toEqual([ 'note', 'tip', 'important', 'warning', 'caution' ]);
    });

    it('reads Obsidian\'s aliases as the kinds they stand for, and an unknown type as a note', () =>
    {
        const kinds = [ '[!tldr]', '[!hint]', '[!faq]', '[!error]', '[!cite]', '[!shopping]' ]
            .map((line) => parseCalloutHeader(line)?.kind);

        expect(kinds).toEqual([ 'abstract', 'tip', 'question', 'danger', 'quote', 'note' ]);
    });

    it('reads a type spelled like a built-in object property as a note', () =>
    {
        const kinds = [ '[!constructor]', '[!toString]', '[!hasOwnProperty]' ]
            .map((line) => parseCalloutHeader(line)?.kind);

        expect(kinds).toEqual([ 'note', 'note', 'note' ]);
    });

    it('takes a title after the marker, and names an untitled callout after its type as written', () =>
    {
        expect(parseCalloutHeader('[!tip] Use the *fast* path')).toMatchObject({
            title: 'Use the *fast* path',
            hasOwnTitle: true,
        });
        expect(parseCalloutHeader('[!faq]')).toMatchObject({ title: 'Faq', hasOwnTitle: false });
    });

    it('reads `-` as folded, `+` as open, and no marker as a callout that does not fold', () =>
    {
        expect(parseCalloutHeader('[!note]- Closed')?.fold).toBe('closed');
        expect(parseCalloutHeader('[!note]+ Open')?.fold).toBe('open');
        expect(parseCalloutHeader('[!note] Plain')?.fold).toBeNull();
    });

    it('measures the marker through its fold marker and the space after it', () =>
    {
        expect(parseCalloutHeader('[!warning]-  Title')?.markerLength).toBe('[!warning]-  '.length);
    });

    it('turns away a line that does not open with a marker', () =>
    {
        expect(parseCalloutHeader('Note: [!NOTE]')).toBeNull();
        expect(parseCalloutHeader('[!NOTE]glued')).toBeNull();
        expect(parseCalloutHeader('[NOTE]')).toBeNull();
    });
});

describe('Callout markdown', () =>
{
    afterEach(() => { closeEditors(); });

    it('writes a callout typed in Preview with its marker unescaped', () =>
    {
        const editor = openMarkdown('', []);
        editor.commands.setContent({
            type: 'doc',
            content: [ {
                type: 'blockquote',
                content: [
                    { type: 'paragraph', content: [ { type: 'text', text: '[!NOTE] Heads up' } ] },
                    { type: 'paragraph', content: [ { type: 'text', text: 'Body [with] brackets' } ] },
                ],
            } ],
        });

        expect(editor.getMarkdown()).toBe('> [!NOTE] Heads up\n> Body \\[with\\] brackets');
    });
});

describe('CalloutMarkers', () =>
{
    afterEach(() => { closeEditors(); });

    // Whether the marker shows, and the name drawn in its place, with the cursor on the title line or below the quote.
    function titleLine(markdown : string, cursorOnTitle : boolean) : { markerShown : boolean; drawnName : string }
    {
        const editor = openMarkdown(`${ markdown }\n\nAfter`, [ CalloutMarkers ]);
        editor.commands.setTextSelection(cursorOnTitle ? 3 : editor.state.doc.content.size - 1);

        const dom = editor.view.dom;
        return {
            markerShown: dom.querySelector('.md-callout-marker') === null,
            drawnName: dom.querySelector('.md-callout-default-title')?.textContent ?? '',
        };
    }

    it('hides the marker and names the callout by its type while the cursor is elsewhere', () =>
    {
        expect(titleLine('> [!warning]\n> Body', false)).toEqual({ markerShown: false, drawnName: 'Warning' });
    });

    it('shows the marker as written while the cursor is on its line', () =>
    {
        expect(titleLine('> [!warning]\n> Body', true)).toEqual({ markerShown: true, drawnName: '' });
    });

    it('draws no name of its own for a callout that has a title', () =>
    {
        expect(titleLine('> [!tip] Mine\n> Body', false)).toEqual({ markerShown: false, drawnName: '' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
