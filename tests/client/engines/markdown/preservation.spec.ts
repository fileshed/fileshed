//----------------------------------------------------------------------------------------------------------------------
// Markdown Preservation
//
// The contract: an edit in Preview changes only what the user edited. The rest of the file is written back byte for
// byte, including syntax Preview doesn't show and the file's own spellings of syntax Preview writes differently
// (`__bold__`, underlined headings, `*` bullets). Where the edit changes the syntax itself, the result still means
// exactly what Preview shows. Driven through the real markdown stack, since its serializer produces the spellings
// being preserved.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '@tiptap/core';
import { TaskList } from '@tiptap/extension-list';
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
import { mergeEdit } from '@client/engines/markdown/preservation.ts';

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
            TaskList,
            MarkdownTaskItem.configure({ nested: true }),
            BlankLines,
        ],
    });
    editor.commands.setContent(markdown, { contentType: 'markdown' });

    editors.push(editor);
    return editor;
}

// The document range of the first occurrence of `text` inside a single text node.
function rangeOf(editor : Editor, text : string) : { from : number; to : number }
{
    let found : { from : number; to : number } | null = null;
    editor.state.doc.descendants((node, pos) =>
    {
        const offset = node.isText ? (node.text ?? '').indexOf(text) : -1;
        if(found === null && offset >= 0) { found = { from: pos + offset, to: pos + offset + text.length }; }
    });

    if(found === null) { throw new Error(`"${ text }" is not in the document`); }
    return found;
}

function replaceText(editor : Editor, text : string, replacement : string) : void
{
    editor.commands.insertContentAt(rangeOf(editor, text), replacement);
}

// Opens `file` in Preview, makes the edit, and returns what the merge writes back.
function editFile(file : string, change : (editor : Editor) => void) : string
{
    const editor = open(file);
    const manager = editor.markdown;
    if(!manager) { throw new Error('the markdown extension is missing'); }

    const before = editor.getMarkdown();
    change(editor);
    const after = editor.getMarkdown();

    return mergeEdit({
        file,
        before,
        after,
        normalize: (markdown) => manager.serialize(manager.parse(markdown)),
    });
}

afterEach(() =>
{
    editors.forEach((editor) => editor.destroy());
    editors = [];
});

//----------------------------------------------------------------------------------------------------------------------

describe('mergeEdit', () =>
{
    it('writes back every line the edit didn\'t touch in the file\'s own spelling', () =>
    {
        const file = 'Title\n=====\nSome __bold__ text.\n* one\n* two\n\nLast line';

        const written = editFile(file, (editor) => replaceText(editor, 'Last line', 'Last line here'));

        expect(written).toBe('Title\n=====\nSome __bold__ text.\n* one\n* two\n\nLast line here');
    });

    it('keeps the rest of an edited line, its spellings and the syntax Preview doesn\'t show included', () =>
    {
        const file = 'Some __bold__ text with ![cat](cat.png) and [TOC] here.';

        const written = editFile(file, (editor) => replaceText(editor, 'text', 'words'));

        expect(written).toBe('Some __bold__ words with ![cat](cat.png) and [TOC] here.');
    });

    it('keeps a reference link on an edited line, with its definition elsewhere in the file', () =>
    {
        const file = 'See [docs][ref] for more.\n\n[ref]: https://example.com';

        const written = editFile(file, (editor) => replaceText(editor, 'more', 'details'));

        expect(written).toBe('See [docs][ref] for details.\n\n[ref]: https://example.com');
    });

    it('keeps every spelling and hidden line of a mixed file when its last paragraph is edited', () =>
    {
        const head = 'Title\n=====\nSome __bold__ text with ![cat](cat.png) and [TOC] here.\n\n<!-- a comment -->\n';
        const file = `${ head }See [docs][ref] for more.\n\n[ref]: https://example.com`;

        const written = editFile(file, (editor) => replaceText(editor, 'for more.', 'for more. Edited.'));

        expect(written).toBe(`${ head }See [docs][ref] for more. Edited.\n\n[ref]: https://example.com`);
    });

    it('keeps HTML Preview doesn\'t show when the line after it is deleted', () =>
    {
        const file = 'A\n<!-- note -->\nB\nC';

        const written = editFile(file, (editor) =>
        {
            const { from, to } = rangeOf(editor, 'B');
            editor.commands.deleteRange({ from: from - 1, to: to + 1 });
        });

        expect(written).toBe('A\n<!-- note -->\nC');
    });

    it('writes a line the edit restyles in Preview\'s spelling, and keeps the lines around it', () =>
    {
        const file = 'Title\n=====\nBody with __bold__';

        const written = editFile(file, (editor) =>
        {
            editor.chain().setTextSelection(rangeOf(editor, 'Title').from)
                .setNode('heading', { level: 2 })
                .run();
        });

        expect(written).toBe('## Title\nBody with __bold__');
    });

    it('puts a line added under an underlined heading below its underline', () =>
    {
        const file = 'Title\n=====\nBody with __bold__';

        const written = editFile(file, (editor) =>
        {
            editor.chain().setTextSelection(rangeOf(editor, 'Title').to)
                .splitBlock()
                .insertContent('Added')
                .run();
        });

        expect(written).toBe('Title\n=====\nAdded\nBody with __bold__');
    });

    it('leaves the file alone when the edit doesn\'t change what Preview writes', () =>
    {
        const file = 'Some __bold__ text.';

        const written = editFile(file, (editor) => { editor.commands.setTextSelection(3); });

        expect(written).toBe(file);
    });

    it('merges an edit deep in a long file whose every text line Preview spells differently', () =>
    {
        const lines = Array.from({ length: 1500 }, (_, index) => [ `Para ${ index } has __bold__.`, '' ]).flat();
        const file = lines.join('\n');

        const written = editFile(file, (editor) => replaceText(editor, 'Para 750 has', 'Para 750 now has'));

        const expected = [ ...lines ];
        expected[1500] = 'Para 750 now has __bold__.';
        expect(written).toBe(expected.join('\n'));
    });
});

//----------------------------------------------------------------------------------------------------------------------
