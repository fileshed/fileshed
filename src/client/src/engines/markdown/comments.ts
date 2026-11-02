//----------------------------------------------------------------------------------------------------------------------
// Markdown Comments
//
// A comment keeps its delimiters in its text, so Preview shows and edits it as the file spells it. Both kinds are
// code to the serializer, which then writes their text without escaping it.
//----------------------------------------------------------------------------------------------------------------------

import { InputRule, Mark, Node } from '@tiptap/core';

//----------------------------------------------------------------------------------------------------------------------
// Inline comments
//----------------------------------------------------------------------------------------------------------------------

const INLINE_COMMENT = /^(?:%%(?:(?!%%)[^\n])+%%|<!--(?:(?!-->)[^\n])*-->)/u;
const TYPED_COMMENT = /(?:%%(?:(?!%%).)+%%|<!--(?:(?!-->).)*-->)$/u;

function firstOf(src : string, markers : string[]) : number
{
    const found = markers.map((marker) => src.indexOf(marker)).filter((index) => index >= 0);

    return found.length > 0 ? Math.min(...found) : -1;
}

export const Comment = Mark.create({
    name: 'comment',
    code: true,
    excludes: '_',
    inclusive: false,

    parseHTML()
    {
        return [ { tag: 'span[data-comment]' } ];
    },

    renderHTML()
    {
        return [ 'span', { 'data-comment': '' }, 0 ];
    },

    markdownTokenizer: {
        name: 'comment',
        level: 'inline',
        start: (src) => firstOf(src, [ '%%', '<!--' ]),
        tokenize: (src) =>
        {
            const match = INLINE_COMMENT.exec(src);
            return match ? { type: 'comment', raw: match[0] } : undefined;
        },
    },

    parseMarkdown: (token, helpers) => helpers.applyMark('comment', [ helpers.createTextNode(token.raw ?? '') ]),

    renderMarkdown: (node, helpers) => helpers.renderChildren(node),

    // A comment typed in Preview dims as its closing marker is typed. A closing `%%` that would pair with the end of an
    // earlier comment is turned away.
    addInputRules()
    {
        return [
            new InputRule({
                find: TYPED_COMMENT,
                handler: ({ state, range }) =>
                {
                    if(state.doc.rangeHasMark(range.from, range.to, this.type)) { return null; }

                    state.tr.addMark(range.from, range.to, this.type.create());
                },
            }),
        ];
    },
});

//----------------------------------------------------------------------------------------------------------------------
// Block comments
//----------------------------------------------------------------------------------------------------------------------

// From a line that opens a `%%` comment without closing it, through the line holding the `%%` that does.
const BLOCK_COMMENT = /^ {0,3}%%(?:(?!%%)[^\n])*\n[\s\S]*?%%[^\n]*/u;
const BLOCK_COMMENT_START = /^ {0,3}%%/mu;

export const CommentBlock = Node.create({
    name: 'commentBlock',
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,

    parseHTML()
    {
        return [ { tag: 'div[data-comment-block]', preserveWhitespace: 'full' } ];
    },

    renderHTML()
    {
        return [ 'div', { 'data-comment-block': '' }, 0 ];
    },

    markdownTokenizer: {
        name: 'commentBlock',
        level: 'block',
        start: (src) => src.search(BLOCK_COMMENT_START),
        tokenize: (src) =>
        {
            const match = BLOCK_COMMENT.exec(src);
            return match ? { type: 'commentBlock', raw: match[0] } : undefined;
        },
    },

    parseMarkdown: (token, helpers) =>
    {
        const source = token.raw ?? '';

        return helpers.createNode('commentBlock', null, source === '' ? [] : [ helpers.createTextNode(source) ]);
    },

    renderMarkdown: (node) => (node.content ?? []).map((child) => child.text ?? '').join(''),
});

//----------------------------------------------------------------------------------------------------------------------
