//----------------------------------------------------------------------------------------------------------------------
// Markdown Comments — `%%` comments and HTML comments
//
// The contract: a comment, on one line or over several, keeps its delimiters and is written back exactly as written,
// with nothing in it escaped. A block of nothing but HTML comments is a comment, not HTML. A `%%` that never closes is
// plain text. A comment typed in Preview becomes one as its closing marker is typed.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

// Engines
import { HtmlBlock, HtmlInline } from '@client/engines/markdown/html.ts';

// Under test
import { Comment, CommentBlock } from '@client/engines/markdown/comments.ts';

// Support
import { closeEditors, openMarkdown, topBlocks, typeText } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const extensions = [ Comment, CommentBlock, HtmlBlock, HtmlInline ];

function commentTexts(markdown : string) : string[]
{
    const texts : string[] = [];
    openMarkdown(markdown, extensions).state.doc.descendants((node) =>
    {
        if(node.isText && node.marks.some((mark) => mark.type.name === 'comment')) { texts.push(node.text ?? ''); }
    });

    return texts;
}

//----------------------------------------------------------------------------------------------------------------------

describe('Comment', () =>
{
    afterEach(() => { closeEditors(); });

    it('keeps an inline `%%` comment and an inline HTML comment as written, delimiters included', () =>
    {
        const markdown = 'Text %%a note%% and <!-- hidden --> here.';

        expect(commentTexts(markdown)).toEqual([ '%%a note%%', '<!-- hidden -->' ]);
        expect(openMarkdown(markdown, extensions).getMarkdown()).toBe(markdown);
    });

    it('writes markdown syntax inside a comment back unescaped', () =>
    {
        const markdown = 'See %%a *b* [c] `d`%% end';

        expect(openMarkdown(markdown, extensions).getMarkdown()).toBe(markdown);
    });

    it('leaves a `%%` that never closes as plain text', () =>
    {
        expect(commentTexts('Rate is 50%% off')).toEqual([]);
    });

    it('dims a comment typed in Preview once its closing marker is typed', () =>
    {
        const editor = openMarkdown('Start', extensions);
        editor.commands.setTextSelection(editor.state.doc.content.size - 1);

        typeText(editor, ' %%later%%');

        expect(commentTexts(editor.getMarkdown())).toEqual([ '%%later%%' ]);
        expect(editor.getMarkdown()).toBe('Start %%later%%');
    });
});

describe('CommentBlock', () =>
{
    afterEach(() => { closeEditors(); });

    it('reads `%%` lines around a block as one comment holding its source, and writes it back unchanged', () =>
    {
        const markdown = '%%\nfirst line\nsecond line\n%%\nAfter';
        const editor = openMarkdown(markdown, extensions);

        expect(topBlocks(editor)).toEqual([ 'commentBlock|%%\nfirst line\nsecond line\n%%', 'paragraph|After' ]);
        expect(editor.getMarkdown()).toBe(markdown);
    });

    it('reads a block of nothing but HTML comments as a comment, not HTML', () =>
    {
        const markdown = '<!-- one -->\n\nAfter';

        expect(topBlocks(openMarkdown(markdown, extensions))).toEqual([
            'commentBlock|<!-- one -->',
            'paragraph|',
            'paragraph|After',
        ]);
    });

    it('leaves an HTML block that holds a tag as HTML, comments and all', () =>
    {
        expect(topBlocks(openMarkdown('<div>\n<!-- note -->\n</div>', extensions))).toEqual([
            'htmlBlock|<div>\n<!-- note -->\n</div>',
        ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
