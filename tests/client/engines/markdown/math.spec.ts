//----------------------------------------------------------------------------------------------------------------------
// Markdown Math — `$…$` and `$$…$$`
//
// The contract: inline math follows Pandoc's rule, so a `$` opens math only with a non-space after it, and closes it
// only with a non-space before it and no digit after it; `$5 and $10` is text. A math block runs from `$$` at the start
// of a line to the `$$` that ends a line. Math keeps its delimiters and is written back with its LaTeX unescaped.
// Preview draws inline math in place of its source while the cursor is off it, and math typed in Preview becomes math
// as its closing `$` is typed. In Preview, `$$` and Enter on an empty line starts a block with its closing `$$`
// written and the cursor on the line between; `$$…$$` on a line of its own becomes a block as its closing `$$` is
// typed; and Enter after a block's closing `$$` goes to a new line after the block.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import { Decoration, type Editor } from '@tiptap/core';

// Under test
import {
    InlineMath,
    InlineMathPreview,
    MathBlock,
    findInlineMath,
    inlineMathLatex,
    mathBlockLatex,
} from '@client/engines/markdown/math.ts';

// Support
import { closeEditors, openMarkdown, pressEnter, topBlocks, typeText } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const extensions = [ InlineMath, MathBlock ];

function inlineSources(markdown : string) : string[]
{
    return findInlineMath(openMarkdown(markdown, extensions).state.doc).map(({ source }) => source);
}

//----------------------------------------------------------------------------------------------------------------------

describe('InlineMath', () =>
{
    afterEach(() => { closeEditors(); });

    it('reads `$…$` with its delimiters, and leaves prices and spaced dollars as text', () =>
    {
        expect(inlineSources('Euler $e^{i\\pi}+1=0$ costs $5 and $10, not $ x$ or $x $ or $x$5.'))
            .toEqual([ '$e^{i\\pi}+1=0$' ]);
    });

    it('writes LaTeX back with its backslashes, underscores and carets unescaped', () =>
    {
        const markdown = 'Sum $\\sum_{i=1}^n x_i$ here';

        expect(openMarkdown(markdown, extensions).getMarkdown()).toBe(markdown);
    });

    it('makes math of `$…$` typed in Preview once the closing `$` is typed', () =>
    {
        const editor = openMarkdown('Start', extensions);
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);

        typeText(editor, ' and $a_1$');

        expect(findInlineMath(editor.state.doc).map(({ source }) => source)).toEqual([ '$a_1$' ]);
        expect(editor.getMarkdown()).toBe('Start and $a_1$');
    });
});

describe('MathBlock', () =>
{
    afterEach(() => { closeEditors(); });

    it('reads `$$` lines around LaTeX as one block holding its source, and writes it back unchanged', () =>
    {
        const markdown = '$$\n\\frac{a}{b}\n$$\nAfter';
        const editor = openMarkdown(markdown, extensions);

        expect(topBlocks(editor)).toEqual([ 'mathBlock|$$\n\\frac{a}{b}\n$$', 'paragraph|After' ]);
        expect(editor.getMarkdown()).toBe(markdown);
    });

    it('leaves the lines of a paragraph with `$$` in them as they are, under either line rule', () =>
    {
        const markdown = 'a $$x$$ b\nOne\n$$y$$ two';

        const lineModel = openMarkdown(markdown, extensions);
        const strict = openMarkdown(markdown, extensions, true);

        expect(topBlocks(lineModel)).toEqual([ 'paragraph|a $$x$$ b', 'paragraph|One', 'paragraph|$$y$$ two' ]);
        expect(lineModel.getMarkdown()).toBe(markdown);
        expect(topBlocks(strict)).toEqual([ 'paragraph|a $$x$$ b\nOne\n$$y$$ two' ]);
        expect(strict.getMarkdown()).toBe(markdown);
    });

    it('reads `$$…$$` on a line of its own as a block', () =>
    {
        expect(topBlocks(openMarkdown('$$ e = mc^2 $$', extensions))).toEqual([ 'mathBlock|$$ e = mc^2 $$' ]);
    });

    it('leaves a line that opens with `$$` and closes it mid-line as text', () =>
    {
        expect(topBlocks(openMarkdown('$$x$$ is inline here\nNext', extensions))[0]).toMatch(/^paragraph\|/u);
    });
});

describe('MathBlock, typed in Preview', () =>
{
    afterEach(() => { closeEditors(); });

    // The cursor at the end of the file's last line.
    function openAtEnd(markdown : string) : Editor
    {
        const editor = openMarkdown(markdown, extensions);
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);

        return editor;
    }

    it('starts a block with its closing `$$` written on `$$` and Enter, with the cursor on the line between', () =>
    {
        const editor = openAtEnd('Before');

        pressEnter(editor);
        typeText(editor, '$$');
        pressEnter(editor);
        typeText(editor, 'x_1');

        expect(topBlocks(editor)).toEqual([ 'paragraph|Before', 'mathBlock|$$\nx_1\n$$' ]);
        expect(editor.getMarkdown()).toBe('Before\n$$\nx_1\n$$');
    });

    it('splits the line as usual on Enter after `$$` when more of the line follows the cursor', () =>
    {
        const editor = openMarkdown('$$abc', extensions);
        editor.commands.setTextSelection(3);

        pressEnter(editor);

        expect(topBlocks(editor)).toEqual([ 'paragraph|$$', 'paragraph|abc' ]);
    });

    it('makes `$$…$$` typed on a line of its own a block once its closing `$$` is typed', () =>
    {
        const editor = openAtEnd('Before');

        pressEnter(editor);
        typeText(editor, '$$e = mc^2$');
        expect(topBlocks(editor)[1]).toBe('paragraph|$$e = mc^2$');

        typeText(editor, '$');
        expect(topBlocks(editor)).toEqual([ 'paragraph|Before', 'mathBlock|$$e = mc^2$$' ]);
    });

    it('goes to a new line after the block on Enter after its closing `$$`', () =>
    {
        const editor = openAtEnd('$$\nx\n$$');

        pressEnter(editor);
        typeText(editor, 'After');

        expect(topBlocks(editor)).toEqual([ 'mathBlock|$$\nx\n$$', 'paragraph|After' ]);
    });

    it('adds a line inside the block on Enter before its closing `$$`', () =>
    {
        const editor = openMarkdown('$$\nx\n$$', extensions);
        editor.commands.setTextSelection(1 + '$$\nx'.length);

        pressEnter(editor);
        typeText(editor, 'y');

        expect(topBlocks(editor)).toEqual([ 'mathBlock|$$\nx\ny\n$$' ]);
    });
});

describe('math sources', () =>
{
    it('takes the delimiters off a block\'s and an inline piece\'s LaTeX', () =>
    {
        expect(mathBlockLatex('$$\n  x^2\n$$')).toBe('x^2');
        expect(mathBlockLatex('$$ y $$')).toBe('y');
        expect(inlineMathLatex('$z$')).toBe('z');
    });
});

describe('InlineMathPreview', () =>
{
    afterEach(() => { closeEditors(); });

    // The widget each piece is drawn with, tagged with the LaTeX it was given.
    function open(markdown : string) : Editor
    {
        return openMarkdown(markdown, [
            ...extensions,
            InlineMathPreview.configure({
                widget: (_editor, pos, key, latex) => Decoration.Widget(pos, () =>
                {
                    const element = document.createElement('span');
                    element.className = 'drawn-math';
                    element.textContent = latex;

                    return element;
                }, { key }),
            }),
        ]);
    }

    function drawn(editor : Editor) : string[]
    {
        return [ ...editor.view.dom.querySelectorAll('.drawn-math') ].map((element) => element.textContent ?? '');
    }

    it('draws each piece of math in place of its hidden source while the cursor is elsewhere', () =>
    {
        const editor = open('A $x$ and $y^2$ here');
        editor.commands.setTextSelection(1);

        expect(drawn(editor)).toEqual([ 'x', 'y^2' ]);
        expect(editor.view.dom.querySelectorAll('.md-math-hidden')).toHaveLength(2);
    });

    it('shows the source of a piece the cursor touches, from either end, and keeps drawing the rest', () =>
    {
        const editor = open('A $x$ and $y^2$ here');
        const [ first ] = findInlineMath(editor.state.doc);

        editor.commands.setTextSelection(first?.from ?? 0);
        expect(drawn(editor)).toEqual([ 'y^2' ]);

        editor.commands.setTextSelection(first?.to ?? 0);
        expect(drawn(editor)).toEqual([ 'y^2' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
