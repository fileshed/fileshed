//----------------------------------------------------------------------------------------------------------------------
// Markdown Callouts
//
// A callout is a quote whose first line is `[!type]`, with an optional fold marker and title after it. That line stays
// text in the quote, so the file keeps its spelling; Preview hides the marker while the cursor is off the line.
//----------------------------------------------------------------------------------------------------------------------

import { Decoration, Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

//----------------------------------------------------------------------------------------------------------------------

// GitHub's five, then Obsidian's others.
export const calloutKinds = [
    'note',
    'tip',
    'important',
    'warning',
    'caution',
    'abstract',
    'info',
    'todo',
    'success',
    'question',
    'failure',
    'danger',
    'bug',
    'example',
    'quote',
] as const;

export type CalloutKind = typeof calloutKinds[number];

// Obsidian's other names for its kinds. IMPORTANT and CAUTION are GitHub's kinds here, where Obsidian reads them as tip
// and warning.
const ALIASES : Readonly<Record<string, CalloutKind>> = {
    summary: 'abstract',
    tldr: 'abstract',
    hint: 'tip',
    check: 'success',
    done: 'success',
    help: 'question',
    faq: 'question',
    attention: 'warning',
    fail: 'failure',
    missing: 'failure',
    error: 'danger',
    cite: 'quote',
};

export interface CalloutHeader
{
    // A type neither GitHub nor Obsidian knows is a note.
    kind : CalloutKind;

    // Null for a callout that doesn't fold; `closed` for the `-` marker, which starts it folded, and `open` for `+`.
    fold : 'open' | 'closed' | null;

    // The title as written, or the type as written with a capital first letter when the line has none.
    title : string;
    hasOwnTitle : boolean;

    // How much of the line the marker takes: `[!type]`, the fold marker, and the space after them.
    markerLength : number;
}

const FOLDS : Readonly<Record<string, 'open' | 'closed'>> = { '-': 'closed', '+': 'open' };
const HEADER = /^\[!([A-Za-z][\w-]*)\]([+-]?)(?:([ \t]+)(.*))?$/u;
const ESCAPED_HEADER = /^\\\[!([A-Za-z][\w-]*)\\\]/u;

function isCalloutKind(word : string) : word is CalloutKind
{
    return (calloutKinds as readonly string[]).includes(word);
}

export function parseCalloutHeader(line : string) : CalloutHeader | null
{
    const match = HEADER.exec(line);
    if(!match) { return null; }

    const [ , type = '', fold = '', space = '', written = '' ] = match;
    const word = type.toLowerCase();
    const title = written.trim();

    return {
        kind: isCalloutKind(word) ? word : ALIASES[word] ?? 'note',
        fold: FOLDS[fold] ?? null,
        title: title === '' ? `${ type.charAt(0).toUpperCase() }${ type.slice(1).toLowerCase() }` : title,
        hasOwnTitle: title !== '',
        markerLength: `[!${ type }]`.length + fold.length + space.length,
    };
}

// The header of the callout a quote is, or null for a plain quote.
export function calloutHeaderOf(quote : ProseMirrorNode) : CalloutHeader | null
{
    const first = quote.firstChild;

    return first?.type.name === 'paragraph' ? parseCalloutHeader(first.textContent) : null;
}

// The serializer escapes the marker's brackets as it would any literal bracket, which makes it text to other tools.
export function unescapeCalloutMarker(line : string) : string
{
    return line.replace(ESCAPED_HEADER, '[!$1]');
}

//----------------------------------------------------------------------------------------------------------------------
// Display
//----------------------------------------------------------------------------------------------------------------------

function defaultTitle(title : string) : () => HTMLElement
{
    return () =>
    {
        const text = document.createElement('span');
        text.className = 'md-callout-default-title';
        text.textContent = title;

        return text;
    };
}

function calloutDecorations(state : EditorState, editable : boolean) : Decoration[]
{
    const { from, to } = state.selection;
    const decorations : Decoration[] = [];
    let index = 0;

    state.doc.descendants((node, pos) =>
    {
        const header = node.type.name === 'blockquote' ? calloutHeaderOf(node) : null;
        const first = node.firstChild;
        if(!header || !first) { return true; }

        const lineStart = pos + 2;
        const editing = editable && from >= lineStart && to <= lineStart + first.content.size;
        decorations.push(Decoration.Node(pos + 1, pos + 1 + first.nodeSize, { class: 'md-callout-title' }));
        if(!editing)
        {
            const markerEnd = lineStart + header.markerLength;
            decorations.push(Decoration.Inline(lineStart, markerEnd, { class: 'md-callout-marker' }));
            if(!header.hasOwnTitle)
            {
                decorations.push(Decoration.Widget(markerEnd, defaultTitle(header.title), {
                    key: `callout-title:${ index }:${ header.title }`,
                    side: 1,
                }));
            }
        }

        index += 1;
        return true;
    });

    return decorations;
}

export const CalloutMarkers = Extension.create({
    name: 'calloutMarkers',

    addDecorations()
    {
        return {
            shouldUpdate: ({ tr }) => tr.docChanged || tr.selectionSet,
            create: ({ editor, state }) => calloutDecorations(state, editor.isEditable),
        };
    },
});

//----------------------------------------------------------------------------------------------------------------------
