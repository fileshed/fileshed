//----------------------------------------------------------------------------------------------------------------------
// Markdown Editor — honest GFM serialization
//
// The markdown handler offers no affordance it can't serialize honestly, so the editor the component builds must
// round-trip its richer features to real GFM. This drives a TipTap editor configured exactly as the component
// configures UEditor for those features -- StarterKit + the markdown extension, plus the task-list and table
// extensions the component layers on -- and asserts the serialized markdown is GFM. Images are out: the editor
// carries no image node, so pasted image markup can't survive to a base64 blob.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';

//----------------------------------------------------------------------------------------------------------------------

let editor : Editor | null = null;

// The editor built from markdown source, mirroring the component's UEditor feature configuration.
function fromMarkdown(source : string) : Editor
{
    editor = new Editor({
        content: source,
        contentType: 'markdown',
        extensions: [
            StarterKit.configure({ underline: false, link: { openOnClick: false } }),
            Markdown.configure({ markedOptions: { gfm: true } }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Table.configure({ resizable: false }),
            TableRow,
            TableHeader,
            TableCell,
        ],
    });

    return editor;
}

// Table serialization pads cells to a common width, so collapse runs of spaces before matching the GFM structure.
function collapseSpaces(markdown : string) : string
{
    return markdown.replace(/ +/g, ' ');
}

afterEach(() =>
{
    editor?.destroy();
    editor = null;
});

//----------------------------------------------------------------------------------------------------------------------

describe('Markdown editor GFM serialization', () =>
{
    it('round-trips a task list to GFM checkbox syntax', () =>
    {
        const md = fromMarkdown('- [ ] pending\n- [x] done').getMarkdown();

        expect(md).toMatch(/- \[ \] pending/);
        expect(md).toMatch(/- \[[xX]\] done/);
    });

    it('round-trips a table to a GFM pipe table', () =>
    {
        const source = '| Name | Qty |\n| --- | --- |\n| Apples | 3 |';

        const md = collapseSpaces(fromMarkdown(source).getMarkdown());

        expect(md).toContain('| Name | Qty |');
        expect(md).toContain('| Apples | 3 |');
        // A GFM header separator row of dashes (cell padding already collapsed).
        expect(md).toMatch(/\|[ :-]*-[ :-]*\|/);
    });

    it('round-trips strikethrough to GFM tildes', () =>
    {
        const md = fromMarkdown('This is ~~gone~~ now.').getMarkdown();

        expect(md).toContain('~~gone~~');
    });

    it('round-trips a fenced code block', () =>
    {
        const md = fromMarkdown('```js\nconst answer = 42;\n```').getMarkdown();

        expect(md).toContain('```');
        expect(md).toContain('const answer = 42;');
    });

    it('carries no image node, so an image can never inline a base64 blob', () =>
    {
        // With no image node in the schema, nothing an image arrives as -- a pasted <img>, a dropped file, or image
        // markdown -- has anywhere to land. Drive the content pipeline with a base64 image reference and prove it
        // leaves no image and no data URI behind.
        const built = fromMarkdown('![screenshot](data:image/png;base64,AAAABBBBCCCC)\n\nBody text.');

        const md = built.getMarkdown();

        expect(built.schema.nodes.image).toBeUndefined();
        expect(md).not.toContain('data:image');
        expect(md).not.toContain('![');
    });
});

//----------------------------------------------------------------------------------------------------------------------
