//----------------------------------------------------------------------------------------------------------------------
// Markdown Line Model
//
// The WYSIWYG surface is a text editor over the file's lines: every visual line is a real line, including the blank
// ones. Enter inserts a newline, so consecutive paragraphs touch; spacing exists only where the document has an
// actual blank line -- a real, cursor-addressable empty paragraph -- and one row of space is always exactly one
// blank line in the file. That mapping holds INSIDE block containers too: a blockquote's or list item's interior
// joins exactly like the document does, or serialize and parse disagree about container interiors and every save
// pads them further -- blank lines that multiply per cycle. CommonMark renderers (GitHub et al.) reflow touching
// lines into one paragraph; the file is exactly what was typed, and how other tools render it is their semantics,
// not ours.
//
// The pieces, front to back:
//
// - marked tokenizers: a `blankLines` block extension claims every newline run as its own token, which also cuts
//   paragraphs at each newline (its `start` hook interrupts the paragraph scan). Heading and table raws get their
//   trailing newlines trimmed back into that run -- stock marked swallows them, which would silently delete blank
//   lines on reload. Blockquotes are confined to their `>`-prefixed lines, killing CommonMark lazy continuation:
//   a line typed under a quote stays outside it.
// - BlankLines: parses a run of N newlines into N-1 empty paragraphs (N when the file opens with them), since one
//   newline is the previous line's terminator.
// - joinBlocks: the one join. Blocks land on consecutive lines; empty paragraphs render to nothing, so their join
//   newlines ARE the blank lines. Two exceptions markdown grammar forces: lists, quotes, and tables lazily swallow
//   a directly-following line, so a non-blank successor gets the terminating blank line written for it; and a
//   trailing empty paragraph carries its own terminator so it survives the reload.
// - MarkdownDocument / MarkdownBlockquote / MarkdownListItem / MarkdownTaskItem: every block container renders its
//   interior through joinBlocks -- quotes then prefix each line with `>`, items put their marker on the first line
//   and indent the rest (blank lines stay bare).
// - MarkdownParagraph: an empty paragraph serializes to nothing. Never `&nbsp;` (the stock escape hatch); parsing
//   is inherited, so legacy `&nbsp;` spacers load as empty paragraphs and heal to blank lines on the next save.
// - MarkdownHardBreak: Shift+Enter serializes as a plain newline, which reloads as the paragraph split it looks
//   like -- the line model has no second kind of line break.
//----------------------------------------------------------------------------------------------------------------------

import { Lexer, Marked, type Token, Tokenizer, type Tokens, getDefaults } from 'marked';
import { Extension, type JSONContent } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { ListItem, TaskItem, getListMarker } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';

// Type-only, and also what puts the Editor augmentations (getMarkdown, setContent's contentType) in the program --
// nothing else in the client imports @tiptap/markdown directly.
import type { MarkdownExtensionOptions } from '@tiptap/markdown';

//----------------------------------------------------------------------------------------------------------------------
// marked instance
//----------------------------------------------------------------------------------------------------------------------

function trimTrailingBlanks<T extends { raw : string }>(token : T | undefined) : T | undefined
{
    if(token) { token.raw = token.raw.replace(/\n+$/u, ''); }
    return token;
}

// Only lines that actually carry the `>` prefix belong to a quote.
const QUOTE_LINES = /^(?: {0,3}>[^\n]*(?:\n|$))+/u;

type MarkedLike = NonNullable<MarkdownExtensionOptions['marked']>;

// A private instance, injected into the Markdown extension rather than patched onto the shared default -- module
// graphs can hold more than one copy of marked (vitest does), and the manager must provably use the patched one.
// The option is typed as the marked namespace itself, but the manager only touches use/lexer/defaults/setOptions
// plus the Lexer class and getDefaults attached here -- a private Marked instance is the same duck, hence the cast.
export const lineModelMarked = Object.assign(new Marked(), { Lexer, getDefaults }) as unknown as MarkedLike;

lineModelMarked.use({
    tokenizer: {
        heading(this : Tokenizer, src : string) : Tokens.Heading | undefined
        {
            return trimTrailingBlanks(Tokenizer.prototype.heading.call(this, src));
        },
        table(this : Tokenizer, src : string) : Tokens.Table | undefined
        {
            return trimTrailingBlanks(Tokenizer.prototype.table.call(this, src));
        },
        blockquote(this : Tokenizer, src : string) : Tokens.Blockquote | undefined
        {
            const confined = QUOTE_LINES.exec(src);
            if(!confined) { return undefined; }

            return Tokenizer.prototype.blockquote.call(this, confined[0]);
        },
    },
    extensions: [
        {
            name: 'blankLines',
            level: 'block',
            start(src : string) : number { return src.indexOf('\n'); },
            tokenizer(src : string, tokens : Token[]) : Tokens.Generic | undefined
            {
                const match = /^\n+/u.exec(src);
                if(!match) { return undefined; }

                return { type: 'blankLines', raw: match[0], leading: tokens.length === 0 };
            },
        },
    ],
});

//----------------------------------------------------------------------------------------------------------------------
// Tiptap extensions
//----------------------------------------------------------------------------------------------------------------------

export const BlankLines = Extension.create({
    name: 'blankLines',

    parseMarkdown: (token) : JSONContent[] =>
    {
        const raw : string = token.raw ?? '';
        const leading = 'leading' in token && token.leading === true;
        const count = leading ? raw.length : raw.length - 1;

        return Array.from({ length: Math.max(count, 0) }, () => ({ type: 'paragraph' }));
    },
});

// Block types whose tokenizers lazily swallow a directly-following line; ending them takes a blank line, and the
// serializer writes that grammar line itself when the next block isn't already one.
const NEEDS_TERMINATOR = new Set([ 'bulletList', 'orderedList', 'taskList', 'blockquote', 'table' ]);

function isEmptyParagraph(node : JSONContent) : boolean
{
    return node.type === 'paragraph' && (node.content ?? []).length === 0;
}

interface JoinHelpers
{
    renderChild ?: (child : JSONContent, index : number) => string;
    indent : (content : string) => string;
}

function joinBlocks(children : JSONContent[], helpers : JoinHelpers) : string
{
    const only = children.length === 1 ? children[0] : undefined;
    if(only && isEmptyParagraph(only)) { return ''; }

    let out = '';
    children.forEach((child, index) =>
    {
        const prev = index > 0 ? children[index - 1] : undefined;
        if(prev)
        {
            const grammarBreak = NEEDS_TERMINATOR.has(prev.type ?? '') && !isEmptyParagraph(child);
            out += grammarBreak ? '\n\n' : '\n';
        }

        // The join owns every boundary newline; a block render that pads itself (the stock table does) would
        // smuggle phantom blank lines into the file.
        out += (helpers.renderChild?.(child, index) ?? '').replace(/^\n+|\n+$/gu, '');
    });

    const last = children[children.length - 1];
    if(last && isEmptyParagraph(last)) { out += '\n'; }

    return out;
}

// Marker on the first line, the rest indented under it; blank lines stay bare, which is the canonical form and
// keeps them from re-parsing as indented content.
function renderListItem(marker : string, node : JSONContent, helpers : JoinHelpers) : string
{
    const [ first = '', ...rest ] = joinBlocks(node.content ?? [], helpers).split('\n');
    const tail = rest.map((line) => { return line.length > 0 ? helpers.indent(line) : ''; });

    return [ `${ marker }${ first }`, ...tail ].join('\n');
}

const ITEM_INLINE = new Set([ 'text', 'hardBreak' ]);

// marked emits tight-item content as bare `text` tokens and the stock item parse paragraph-wraps only the first,
// so a text line after a blank line inside an item lands as a naked inline child. Every line is a paragraph in the
// line model -- gather stray inline runs into paragraphs.
function wrapStrayInline<T extends JSONContent | JSONContent[] | null | undefined>(item : T) : T
{
    if(!item || Array.isArray(item)) { return item; }

    const out : JSONContent[] = [];
    let run : JSONContent[] = [];
    const flush = () : void =>
    {
        if(run.length > 0) { out.push({ type: 'paragraph', content: run }); run = []; }
    };

    for(const child of item.content ?? [])
    {
        if(ITEM_INLINE.has(child.type ?? '')) { run.push(child); }
        else { flush(); out.push(child); }
    }
    flush();

    return { ...item, content: out };
}

export const MarkdownDocument = Document.extend({
    renderMarkdown: (node, helpers) : string => joinBlocks(node.content ?? [], helpers),
});

export const MarkdownBlockquote = Blockquote.extend({
    renderMarkdown: (node, helpers) : string =>
    {
        return joinBlocks(node.content ?? [], helpers)
            .split('\n')
            .map((line) => { return line.length > 0 ? `> ${ line }` : '>'; })
            .join('\n');
    },
});

const stockListItemParse = ListItem.config.parseMarkdown;
const stockTaskItemParse = TaskItem.config.parseMarkdown;

export const MarkdownListItem = ListItem.extend({
    parseMarkdown: (token, helpers) => wrapStrayInline(stockListItemParse?.(token, helpers) ?? []),

    renderMarkdown: (node, helpers, ctx) : string =>
    {
        const meta = ctx.meta as { parentAttrs ?: { start ?: number; type ?: string | null } } | undefined;
        const attrs = meta?.parentAttrs ?? {};
        const marker = ctx.parentType === 'orderedList'
            ? getListMarker(attrs.type, (attrs.start ?? 1) - 1 + (ctx.index ?? 0), '. ')
            : '- ';

        return renderListItem(marker, node, helpers);
    },
});

export const MarkdownTaskItem = TaskItem.extend({
    parseMarkdown: (token, helpers) => wrapStrayInline(stockTaskItemParse?.(token, helpers) ?? []),

    renderMarkdown: (node, helpers) : string =>
    {
        const checked = node.attrs?.checked === true;

        return renderListItem(`- [${ checked ? 'x' : ' ' }] `, node, helpers);
    },
});

export const MarkdownParagraph = Paragraph.extend({
    renderMarkdown: (node, helpers) : string =>
    {
        const content = node.content ?? [];
        if(content.length === 0) { return ''; }

        return helpers.renderChildren(content);
    },
});

export const MarkdownHardBreak = HardBreak.extend({
    renderMarkdown: () : string => '\n',
});

//----------------------------------------------------------------------------------------------------------------------
