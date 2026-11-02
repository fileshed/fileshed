//----------------------------------------------------------------------------------------------------------------------
// Markdown Test Support
//
// An editor over the Preview line-model stack, for the specs whose syntax must parse and write back through it.
//----------------------------------------------------------------------------------------------------------------------

import { Editor, type Extensions, type JSONContent } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import type { Transaction } from '@tiptap/pm/state';

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

//----------------------------------------------------------------------------------------------------------------------

let editors : Editor[] = [];

export function openMarkdown(markdown : string, extensions : Extensions) : Editor
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
                trailingNode: false,
            }),
            MarkdownDocument,
            MarkdownBlockquote,
            MarkdownListItem,
            MarkdownParagraph,
            MarkdownHardBreak,
            BlankLines,
            ...extensions,
        ],
    });
    editor.commands.setContent(markdown, { contentType: 'markdown' });

    editors.push(editor);
    return editor;
}

export function closeEditors() : void
{
    editors.forEach((editor) => editor.destroy());
    editors = [];
}

function textOf(node : JSONContent) : string
{
    return node.text ?? (node.content ?? []).map(textOf).join('');
}

// Each top-level block as `type|text`.
export function topBlocks(editor : Editor) : string[]
{
    const content : JSONContent[] = editor.getJSON().content ?? [];

    return content.map((block) => `${ block.type ?? '' }|${ textOf(block) }`);
}

export function pressEnter(editor : Editor) : void
{
    const { view } = editor;
    view.someProp('handleKeyDown', (handle) => handle(view, new KeyboardEvent('keydown', { key: 'Enter' })));
}

// Text typed at the cursor a character at a time, so the editor's input rules see each keystroke.
export function typeText(editor : Editor, text : string) : void
{
    const { view } = editor;
    for(const character of text)
    {
        const { from, to } = view.state.selection;
        const insert = () : Transaction => view.state.tr.insertText(character, from, to);
        const handled = view.someProp('handleTextInput', (handle) => handle(view, from, to, character, insert));
        if(!handled) { view.dispatch(insert()); }
    }
}

//----------------------------------------------------------------------------------------------------------------------
