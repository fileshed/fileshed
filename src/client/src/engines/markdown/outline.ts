//----------------------------------------------------------------------------------------------------------------------
// Markdown Outline
//----------------------------------------------------------------------------------------------------------------------

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

//----------------------------------------------------------------------------------------------------------------------

export interface OutlineEntry
{
    level : number;
    text : string;

    // The heading's document position, for scrolling to it.
    pos : number;
}

//----------------------------------------------------------------------------------------------------------------------

// The document's own headings, in order. A heading nested inside a quote or list belongs to that block, not the
// outline, and an empty heading has nothing to list.
export function buildOutline(doc : ProseMirrorNode) : OutlineEntry[]
{
    const entries : OutlineEntry[] = [];

    doc.forEach((node, pos) =>
    {
        const text = node.textContent.trim();
        if(node.type.name !== 'heading' || text === '') { return; }

        entries.push({ level: Number(node.attrs.level), text, pos });
    });

    return entries;
}

// The section a document position falls in: the last heading at or before it. Text above the first heading is in no
// section.
export function findActiveEntry(outline : OutlineEntry[], position : number) : OutlineEntry | null
{
    return outline.findLast((entry) => entry.pos <= position) ?? null;
}

//----------------------------------------------------------------------------------------------------------------------
