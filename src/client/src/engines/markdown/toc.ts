//----------------------------------------------------------------------------------------------------------------------
// Markdown Table of Contents
//
// The marker line keeps its own spelling as the node's text.
//----------------------------------------------------------------------------------------------------------------------

import { InputRule, Node } from '@tiptap/core';

//----------------------------------------------------------------------------------------------------------------------

const MARKER = String.raw`(?:\[TOC\]|\[\[toc\]\]|\[\[TOC\]\]|\[\[_TOC_\]\])`;
const MARKER_LINE = new RegExp(String.raw`^ {0,3}${ MARKER }[ \t]*(?=\n|$)`, 'u');
const WHOLE_MARKER = new RegExp(String.raw`^ {0,3}${ MARKER }[ \t]*$`, 'u');
const TYPED_MARKER = new RegExp(String.raw`^ {0,3}${ MARKER }$`, 'u');

export function isTOCMarker(text : string) : boolean
{
    return WHOLE_MARKER.test(text);
}

export const TableOfContents = Node.create({
    name: 'tableOfContents',
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,

    parseHTML()
    {
        return [ { tag: 'div[data-toc]', preserveWhitespace: 'full' } ];
    },

    renderHTML()
    {
        return [ 'div', { 'data-toc': '' }, 0 ];
    },

    markdownTokenizer: {
        name: 'tableOfContents',
        level: 'block',
        start: (src) => src.search(/^ {0,3}\[/mu),
        tokenize: (src) =>
        {
            const match = MARKER_LINE.exec(src);
            return match ? { type: 'tableOfContents', raw: match[0] } : undefined;
        },
    },

    parseMarkdown: (token, helpers) =>
    {
        return helpers.createNode('tableOfContents', null, [ helpers.createTextNode(token.raw ?? '') ]);
    },

    renderMarkdown: (node) => (node.content ?? []).map((child) => child.text ?? '').join(''),

    // Typing a marker on a line of its own turns the line into a table of contents. Without this the serializer would
    // escape the brackets and the file would hold no marker.
    addInputRules()
    {
        return [
            new InputRule({
                find: TYPED_MARKER,
                handler: ({ state, range }) =>
                {
                    const $end = state.doc.resolve(range.to);
                    if($end.parent.type.name !== 'paragraph' || $end.parentOffset !== $end.parent.content.size)
                    {
                        return null;
                    }

                    state.tr.setBlockType(range.from, range.to, this.type);
                },
            }),
        ];
    },
});

//----------------------------------------------------------------------------------------------------------------------
