//----------------------------------------------------------------------------------------------------------------------
// Code Highlighting — code blocks in Preview
//
// The contract: code in a block whose fence names a known language is highlighted once that language's grammar has
// loaded, and highlighted again after any edit to the block or its language. Code in a block naming no known language
// stays plain. Driven through a real TipTap editor, since the highlighting is drawn into its document.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

// Under test
import { CodeHighlight } from '@client/engines/markdown/codeHighlight.ts';

//----------------------------------------------------------------------------------------------------------------------

let editors : Editor[] = [];

function open(markdown : string) : Editor
{
    const editor = new Editor({
        element: document.createElement('div'),
        extensions: [ StarterKit, Markdown, CodeHighlight ],
        content: markdown,
        contentType: 'markdown',
    });

    editors.push(editor);
    return editor;
}

// The highlighted pieces of the document's code, as `text:classes`.
function highlighted(editor : Editor) : string[]
{
    return [ ...editor.view.dom.querySelectorAll('pre [class^="tok-"]') ]
        .map((span) => `${ span.textContent ?? '' }:${ span.className }`);
}

function setLanguage(editor : Editor, language : string | null) : void
{
    editor.state.doc.descendants((node, pos) =>
    {
        if(node.type.name !== 'codeBlock') { return true; }

        editor.commands.command(({ tr }) =>
        {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, language });
            return true;
        });
        return false;
    });
}

afterEach(() =>
{
    editors.forEach((editor) => editor.destroy());
    editors = [];
});

//----------------------------------------------------------------------------------------------------------------------

describe('CodeHighlight', () =>
{
    it('highlights code in the language its fence names once the grammar has loaded', async () =>
    {
        const editor = open('```ts\nconst answer = 42;\n```');

        await vi.waitFor(() => expect(highlighted(editor)).toContain('const:tok-keyword'));
        expect(highlighted(editor)).toContain('42:tok-number');
    });

    it('highlights code in a block nested inside a quote', async () =>
    {
        const editor = open('> ```python\n> return None\n> ```');

        await vi.waitFor(() => expect(highlighted(editor)).toContain('return:tok-keyword'));
    });

    it('leaves code plain when its fence names no language it knows', async () =>
    {
        const editor = open('```foobar\nconst answer = 42;\n```\n\n```\nconst answer = 42;\n```');
        await new Promise((resolve) => { setTimeout(resolve, 50); });

        expect(highlighted(editor)).toEqual([]);
    });

    it('highlights the code again after an edit to it', async () =>
    {
        const editor = open('```ts\nconst answer = 42;\n```');
        await vi.waitFor(() => expect(highlighted(editor)).toContain('42:tok-number'));

        const block = editor.state.doc.firstChild;
        editor.commands.insertContentAt((block?.nodeSize ?? 0) - 1, ' // why');

        expect(highlighted(editor)).toContain('// why:tok-comment');
    });

    it('highlights the code again when its block\'s language changes', async () =>
    {
        const editor = open('```\nconst answer = 42;\n```');

        setLanguage(editor, 'javascript');
        await vi.waitFor(() => expect(highlighted(editor)).toContain('const:tok-keyword'));

        setLanguage(editor, null);
        expect(highlighted(editor)).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
