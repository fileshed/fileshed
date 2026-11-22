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
//   paragraphs at each newline (its `start` hook interrupts the paragraph scan). Heading, table and HTML block raws get
//   their trailing newlines trimmed back into that run -- stock marked swallows them, which would silently delete
//   blank lines on reload. Blockquotes are confined to their `>`-prefixed lines, killing CommonMark lazy continuation:
//   a line typed under a quote stays outside it.
// - BlankLines: parses a run of N newlines into N-1 empty paragraphs (N when the file opens with them), since one
//   newline is the previous line's terminator.
// - joinBlocks: the one join. Blocks land on consecutive lines; empty paragraphs render to nothing, so their join
//   newlines ARE the blank lines. Three exceptions markdown grammar forces: lists, quotes, tables, footnote
//   definitions, and most HTML blocks swallow a directly-following line, so a non-blank successor gets the terminating
//   blank line written for it; a `---` divider directly under a text line would underline it into a heading, so it
//   gets a blank line before it; and a trailing empty paragraph carries its own terminator so it survives the reload.
// - MarkdownDocument / MarkdownBlockquote / MarkdownListItem / MarkdownTaskItem: every block container renders its
//   interior through joinBlocks -- quotes then prefix each line with `>` and keep a callout's marker unescaped, items
//   put their marker on the first line and indent the rest (blank lines stay bare).
// - MarkdownParagraph: an empty paragraph serializes to nothing. Never `&nbsp;` (the stock escape hatch); parsing
//   is inherited, so legacy `&nbsp;` spacers load as empty paragraphs and heal to blank lines on the next save.
// - MarkdownHardBreak: Shift+Enter serializes as a plain newline, which reloads as the paragraph split it looks
//   like -- the line model has no second kind of line break.
// - MarkdownTaskList / MarkdownTable: the stock task list and table, with tokenizer hooks that read only the lines
//   they decide on. marked runs every block tokenizer on the rest of the file at every block, and the stock hooks split
//   all of it into lines first, which made a long file's parse quadratic in its length. The task list also leaves the
//   blank lines around it to BlankLines, as the heading and table raws do.
//
// Strict line breaks, for a file whose frontmatter sets `strict-line-breaks`: CommonMark's paragraphs, and the line
// model everywhere else. strictLineModelMarked doesn't cut paragraphs at each newline, so touching lines are one
// paragraph, whose text keeps the newlines between them. The blank line that ends a paragraph is its terminator rather
// than an empty paragraph, so joinBlocks writes one after every paragraph, and a hard break is written as a backslash
// at the end of its line, since a plain newline would only continue the paragraph. Every other blank line is still an
// empty paragraph.
//----------------------------------------------------------------------------------------------------------------------

import { Lexer, Marked, type Token, Tokenizer, type Tokens, getDefaults } from 'marked';
import { Decoration, Extension, type JSONContent } from '@tiptap/core';
import { Blockquote, type BlockquoteOptions } from '@tiptap/extension-blockquote';
import { Document } from '@tiptap/extension-document';
import { HardBreak, type HardBreakOptions } from '@tiptap/extension-hard-break';
import {
    ListItem,
    type ListItemOptions,
    TaskItem,
    type TaskItemOptions,
    TaskList,
    getListMarker,
} from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Table } from '@tiptap/extension-table';

// Type-only, and also what puts the Editor augmentations (getMarkdown, setContent's contentType) in the program --
// nothing else in the client imports @tiptap/markdown directly.
import type { MarkdownExtensionOptions } from '@tiptap/markdown';

// Engines
import { htmlBlockTakesNextLine } from './html.ts';
import { unescapeCalloutMarker } from './callouts.ts';

//----------------------------------------------------------------------------------------------------------------------
// marked instance
//----------------------------------------------------------------------------------------------------------------------

function trimTrailingBlanks<T extends { raw : string }>(token : T | undefined) : T | undefined
{
    if(token) { token.raw = token.raw.replace(/\n+$/u, ''); }
    return token;
}

// marked hands a block extension's `start` hook the paragraph from its second character on, so the hook's text begins
// mid-line and a block can only open after one of its newlines. `opening` matches that newline and the start of the
// block's line; the result is where that line starts, or -1.
export function findBlockStart(src : string, opening : RegExp) : number
{
    const index = src.search(opening);
    return index === -1 ? -1 : index + 1;
}

// Only lines that actually carry the `>` prefix belong to a quote.
const QUOTE_LINES = /^(?: {0,3}>[^\n]*(?:\n|$))+/u;

type MarkedLike = NonNullable<MarkdownExtensionOptions['marked']>;

export interface LineBreakOptions
{
    strictLineBreaks : boolean;
}

// A private instance, injected into the Markdown extension rather than patched onto the shared default -- module
// graphs can hold more than one copy of marked (vitest does), and the manager must provably use the patched one.
// The option is typed as the marked namespace itself, but the manager only touches use/lexer/defaults/setOptions
// plus the Lexer class and getDefaults attached here -- a private Marked instance is the same duck, hence the cast.
function buildLineModelMarked(strictLineBreaks : boolean) : MarkedLike
{
    const marked = Object.assign(new Marked(), { Lexer, getDefaults }) as unknown as MarkedLike;
    marked.use({
        tokenizer: {
            heading(this : Tokenizer, src : string) : Tokens.Heading | undefined
            {
                return trimTrailingBlanks(Tokenizer.prototype.heading.call(this, src));
            },
            table(this : Tokenizer, src : string) : Tokens.Table | undefined
            {
                return trimTrailingBlanks(Tokenizer.prototype.table.call(this, src));
            },
            html(this : Tokenizer, src : string) : Tokens.HTML | undefined
            {
                return trimTrailingBlanks(Tokenizer.prototype.html.call(this, src));
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

                // Cutting the paragraph scan at each newline is what makes every line a paragraph of its own.
                start(src : string) : number { return strictLineBreaks ? -1 : src.indexOf('\n'); },
                tokenizer(src : string, tokens : Token[]) : Tokens.Generic | undefined
                {
                    const match = /^\n+/u.exec(src);
                    if(!match) { return undefined; }

                    // marked joins a paragraph's lines (`text` tokens inside a list item) only when nothing stands
                    // between them, so a strict file leaves it a lone newline inside one: after `text`, and after a
                    // paragraph that another block's `start` hook cut short of a line that turned out not to be one.
                    // After a paragraph, a newline that ends the file is still claimed, as the trailing run below.
                    const previous = tokens.at(-1)?.type;
                    const isLone = match[0].length === 1;
                    const isInside = previous === 'text' || (previous === 'paragraph' && src.length > 1);
                    if(strictLineBreaks && isLone && isInside) { return undefined; }

                    // The run's length rides on a field of our own rather than being read back off `raw`: the token
                    // reaches parseMarkdown with `raw` emptied, and a count taken from there is a count of nothing.
                    // `trailing` marks the run that ends the source, which the parser turns into an empty paragraph
                    // by itself -- so the count below leaves that one to it rather than writing a second.
                    // `afterParagraph` marks a run whose first blank line is a strict paragraph's terminator.
                    return {
                        type: 'blankLines',
                        raw: match[0],
                        newlines: match[0].length,
                        leading: tokens.length === 0,
                        trailing: match[0].length === src.length,
                        afterParagraph: strictLineBreaks && (previous === 'paragraph' || previous === 'text'),
                    };
                },
            },
        ],
    });

    return marked;
}

export const lineModelMarked = buildLineModelMarked(false);
export const strictLineModelMarked = buildLineModelMarked(true);

//----------------------------------------------------------------------------------------------------------------------
// Tiptap extensions
//----------------------------------------------------------------------------------------------------------------------

// The nodes below extend stock ones, so there are always stock options to keep.
function withLineBreakOption<Options>(stock : (() => Options) | undefined) : Options & LineBreakOptions
{
    if(!stock) { throw new Error('A line-model node keeps the options of the stock node it extends.'); }

    return { ...stock(), strictLineBreaks: false };
}

export const BlankLines = Extension.create({
    name: 'blankLines',

    parseMarkdown: (token) : JSONContent[] =>
    {
        const newlines = 'newlines' in token && typeof token.newlines === 'number' ? token.newlines : 0;
        const leading = 'leading' in token && token.leading === true;
        const trailing = 'trailing' in token && token.trailing === true;
        const afterParagraph = 'afterParagraph' in token && token.afterParagraph === true;

        // One newline is the previous line's terminator, one more a strict paragraph's, and the run that ends the
        // source already has an empty paragraph made for it by the parser.
        const count = (leading ? newlines : newlines - 1) - (afterParagraph ? 1 : 0) - (trailing ? 1 : 0);

        return Array.from({ length: Math.max(count, 0) }, () => ({ type: 'paragraph' }));
    },
});

// Block types whose tokenizers lazily swallow a directly-following line; ending them takes a blank line, and the
// serializer writes that grammar line itself when the next block isn't already one.
const needsTerminator = new Set([
    'bulletList',
    'orderedList',
    'taskList',
    'blockquote',
    'table',
    'footnoteDefinition',
]);

function isEmptyParagraph(node : JSONContent) : boolean
{
    return node.type === 'paragraph' && (node.content ?? []).length === 0;
}

// A definition line starts a footnote of its own, so definitions sit on consecutive lines like the items of a list.
function needsBlankLineBetween(prev : JSONContent, child : JSONContent, strictLineBreaks : boolean) : boolean
{
    if(prev.type === 'footnoteDefinition' && child.type === 'footnoteDefinition') { return false; }
    if(strictLineBreaks && prev.type === 'paragraph' && !isEmptyParagraph(prev)) { return true; }
    if(needsTerminator.has(prev.type ?? '') || htmlBlockTakesNextLine(prev)) { return !isEmptyParagraph(child); }

    return child.type === 'horizontalRule' && prev.type === 'paragraph' && !isEmptyParagraph(prev);
}

export interface JoinHelpers
{
    renderChild ?: (child : JSONContent, index : number) => string;
    indent : (content : string) => string;
}

export function joinBlocks(children : JSONContent[], helpers : JoinHelpers, strictLineBreaks : boolean) : string
{
    const only = children.length === 1 ? children[0] : undefined;
    if(only && isEmptyParagraph(only)) { return ''; }

    let out = '';
    children.forEach((child, index) =>
    {
        const prev = index > 0 ? children[index - 1] : undefined;
        if(prev) { out += needsBlankLineBetween(prev, child, strictLineBreaks) ? '\n\n' : '\n'; }

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
function renderListItem(marker : string, node : JSONContent, helpers : JoinHelpers, strictLineBreaks : boolean) : string
{
    const [ first = '', ...rest ] = joinBlocks(node.content ?? [], helpers, strictLineBreaks).split('\n');
    const tail = rest.map((line) => { return line.length > 0 ? helpers.indent(line) : ''; });

    return [ `${ marker }${ first }`, ...tail ].join('\n');
}

const itemInlineTypes = new Set([ 'text', 'hardBreak' ]);

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
        if(itemInlineTypes.has(child.type ?? '')) { run.push(child); }
        else { flush(); out.push(child); }
    }
    flush();

    return { ...item, content: out };
}

export const MarkdownDocument = Document.extend<LineBreakOptions>({
    addOptions()
    {
        return { strictLineBreaks: false };
    },

    renderMarkdown(node, helpers) : string
    {
        return joinBlocks(node.content ?? [], helpers, this.options.strictLineBreaks);
    },
});

export const MarkdownBlockquote = Blockquote.extend<BlockquoteOptions & LineBreakOptions>({
    addOptions()
    {
        return withLineBreakOption(this.parent);
    },

    renderMarkdown(node, helpers) : string
    {
        return unescapeCalloutMarker(joinBlocks(node.content ?? [], helpers, this.options.strictLineBreaks))
            .split('\n')
            .map((line) => { return line.length > 0 ? `> ${ line }` : '>'; })
            .join('\n');
    },
});

export const MarkdownListItem = ListItem.extend<ListItemOptions & LineBreakOptions>({
    addOptions()
    {
        return withLineBreakOption(this.parent);
    },

    parseMarkdown(token, helpers)
    {
        return wrapStrayInline(this.parent?.(token, helpers) ?? []);
    },

    renderMarkdown(node, helpers, ctx) : string
    {
        const meta = ctx.meta as { parentAttrs ?: { start ?: number; type ?: string | null } } | undefined;
        const attrs = meta?.parentAttrs ?? {};
        const marker = ctx.parentType === 'orderedList'
            ? getListMarker(attrs.type, (attrs.start ?? 1) - 1 + (ctx.index ?? 0), '. ')
            : '- ';

        return renderListItem(marker, node, helpers, this.options.strictLineBreaks);
    },
});

export const MarkdownTaskItem = TaskItem.extend<TaskItemOptions & LineBreakOptions>({
    addOptions()
    {
        return withLineBreakOption(this.parent);
    },

    parseMarkdown(token, helpers)
    {
        return wrapStrayInline(this.parent?.(token, helpers) ?? []);
    },

    renderMarkdown(node, helpers) : string
    {
        const checked = node.attrs?.checked === true;

        return renderListItem(`- [${ checked ? 'x' : ' ' }] `, node, helpers, this.options.strictLineBreaks);
    },
});

// A task list starts at a task item, so any other first line is turned away without reading on. The stock tokenizer
// takes blank lines on both sides into the list, those ahead of the first item and the newline after the last; skipped
// here and trimmed off, they go to BlankLines and stay real lines.
const TASK_ITEM = /^[^\S\n]*[-+*][^\S\n]+\[[ xX]\][^\S\n]+/u;
const stockTaskListTokenizer = TaskList.config.markdownTokenizer;

export const MarkdownTaskList = TaskList.extend({
    markdownTokenizer: stockTaskListTokenizer && {
        ...stockTaskListTokenizer,
        tokenize: (src, tokens, lexer) =>
        {
            if(!TASK_ITEM.test(src)) { return undefined; }

            const token = stockTaskListTokenizer.tokenize(src, tokens, lexer);
            return token ? { ...token, raw: token.raw?.replace(/\n+$/u, '') } : token;
        },
    },
});

// A table starts where a line with a pipe sits over a delimiter row, so the stock start hook only ever reads the
// first two lines; it gets just those.
const FIRST_TWO_LINES = /^[^\n]*(?:\n[^\n]*)?/u;
const stockTableTokenizer = Table.config.markdownTokenizer;
const stockTableStart = stockTableTokenizer?.start;

export const MarkdownTable = Table.extend({
    markdownTokenizer: stockTableTokenizer && {
        ...stockTableTokenizer,
        start: typeof stockTableStart === 'function'
            ? (src) => stockTableStart(FIRST_TWO_LINES.exec(src)?.[0] ?? '')
            : stockTableStart,
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

export const MarkdownHardBreak = HardBreak.extend<HardBreakOptions & LineBreakOptions>({
    addOptions()
    {
        return withLineBreakOption(this.parent);
    },

    renderMarkdown() : string
    {
        return this.options.strictLineBreaks ? '\\\n' : '\n';
    },
});

// How a strict file's paragraphs draw. Their newlines show as the spaces CommonMark reads them as: the editor shows
// whitespace as typed, so each newline is wrapped in a span that collapses it. A paragraph with a block after it is
// marked as ending on a blank line, which the file has there, so a row of space still stands for each blank line.
export const StrictParagraphs = Extension.create({
    name: 'strictParagraphs',

    addDecorations()
    {
        return {
            shouldUpdate: ({ tr }) => tr.docChanged,
            create: ({ state }) =>
            {
                const decorations : Decoration[] = [];
                state.doc.descendants((node, pos, parent, index) =>
                {
                    const isFollowed = parent !== null && index < parent.childCount - 1;
                    if(node.type.name === 'paragraph' && node.content.size > 0 && isFollowed)
                    {
                        decorations.push(Decoration.Node(pos, pos + node.nodeSize, { class: 'md-paragraph-end' }));
                    }
                    if(!node.isText) { return node.type.spec.code !== true; }

                    const text = node.text ?? '';
                    for(let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1))
                    {
                        decorations.push(Decoration.Inline(pos + at, pos + at + 1, { class: 'md-soft-break' }));
                    }

                    return false;
                });

                return decorations;
            },
        };
    },
});

//----------------------------------------------------------------------------------------------------------------------
