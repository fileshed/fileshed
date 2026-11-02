//----------------------------------------------------------------------------------------------------------------------
// Markdown HTML
//
// HTML keeps its source: a block holds it as its text, an inline piece as an attribute, and both write it back
// unchanged. A block of nothing but comments is a comment block (comments.ts), not HTML.
//----------------------------------------------------------------------------------------------------------------------

import { type JSONContent, Node } from '@tiptap/core';

//----------------------------------------------------------------------------------------------------------------------
// Blocks
//----------------------------------------------------------------------------------------------------------------------

const COMMENTS_ONLY = /^(?:\s*<!--[\s\S]*?-->)+\s*$/u;

// The HTML blocks that end at a closing marker of their own: <pre>, <script>, <style> and <textarea> elements,
// comments, processing instructions, declarations and CDATA. Every other kind runs on until a blank line.
const ENDS_AT_OWN_MARKER = /^ {0,3}<(?:(?:pre|script|style|textarea)(?:[\s>]|$)|!--|\?|![A-Za-z]|!\[CDATA\[)/iu;

function textOf(node : JSONContent) : string
{
    return (node.content ?? []).map((child) => child.text ?? '').join('');
}

// Whether a line written directly under this HTML block would be read as part of it.
export function htmlBlockTakesNextLine(node : JSONContent) : boolean
{
    return node.type === 'htmlBlock' && !ENDS_AT_OWN_MARKER.test(textOf(node));
}

export const HtmlBlock = Node.create({
    name: 'htmlBlock',
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,

    parseHTML()
    {
        return [ { tag: 'div[data-html-block]', preserveWhitespace: 'full' } ];
    },

    renderHTML()
    {
        return [ 'div', { 'data-html-block': '' }, [ 'pre', 0 ] ];
    },

    markdownTokenName: 'html',

    // Inline HTML that reaches the block parser goes on to the markdown parser's own handling.
    parseMarkdown: (token, helpers) =>
    {
        const source = token.raw ?? '';
        if(token.block !== true) { return []; }

        const content = source === '' ? [] : [ helpers.createTextNode(source) ];
        return helpers.createNode(COMMENTS_ONLY.test(source) ? 'commentBlock' : 'htmlBlock', null, content);
    },

    renderMarkdown: (node) => textOf(node),
});

//----------------------------------------------------------------------------------------------------------------------
// Inline pieces
//----------------------------------------------------------------------------------------------------------------------

const ATTRIBUTE = String.raw`\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?`;
const OPEN_TAG = new RegExp(String.raw`^<([A-Za-z][A-Za-z0-9-]*)(?:${ ATTRIBUTE })*\s*(\/?)>`, 'u');
const CLOSE_TAG = /^<\/[A-Za-z][A-Za-z0-9-]*\s*>/u;
const VOID_ELEMENTS = [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'source',
    'track',
    'wbr',
];

// Where the element an opening tag starts ends: past the closing tag that balances it, counting the elements of the
// same name nested inside. Null when the text holds no such closing tag.
function elementEnd(src : string, name : string, from : number) : number | null
{
    const tags = new RegExp(String.raw`<(\/?)${ name }(?=[\s/>])[^>]*>`, 'giu');
    tags.lastIndex = from;

    let depth = 1;
    for(let match = tags.exec(src); match; match = tags.exec(src))
    {
        depth += match[1] === '/' ? -1 : 1;
        if(depth === 0) { return tags.lastIndex; }
    }

    return null;
}

// One inline piece of HTML: an element from its opening tag through the closing tag that balances it, or a tag on its
// own (a void element, a self-closing tag, or one whose partner isn't on the line).
export function tokenizeInlineHTML(src : string) : { type : 'htmlInline'; raw : string } | undefined
{
    const open = OPEN_TAG.exec(src);
    if(open)
    {
        const [ tag, name = '', selfClosing ] = open;
        const isElement = selfClosing === '' && !VOID_ELEMENTS.includes(name.toLowerCase());
        const end = isElement ? elementEnd(src, name, tag.length) : null;

        return { type: 'htmlInline', raw: src.slice(0, end ?? tag.length) };
    }

    const close = CLOSE_TAG.exec(src);
    return close ? { type: 'htmlInline', raw: close[0] } : undefined;
}

export const HtmlInline = Node.create({
    name: 'htmlInline',
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes()
    {
        return { source: { default: '' } };
    },

    parseHTML()
    {
        return [ {
            tag: 'span[data-html-inline]',
            getAttrs: (element) => ({ source: element.getAttribute('data-source') ?? '' }),
        } ];
    },

    renderHTML({ node })
    {
        return [ 'span', { 'data-html-inline': '', 'data-source': node.attrs.source as string } ];
    },

    markdownTokenName: 'htmlInline',

    markdownTokenizer: {
        name: 'htmlInline',
        level: 'inline',
        start: (src) => src.indexOf('<'),
        tokenize: (src) => tokenizeInlineHTML(src),
    },

    parseMarkdown: (token, helpers) => helpers.createNode('htmlInline', { source: token.raw ?? '' }),

    renderMarkdown: (node) => (node.attrs?.source as string | undefined) ?? '',
});

//----------------------------------------------------------------------------------------------------------------------
