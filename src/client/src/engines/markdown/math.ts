//----------------------------------------------------------------------------------------------------------------------
// Markdown Math
//
// Math keeps its `$` delimiters in its text, so Preview edits the source the file has; both kinds are code to the
// serializer, which then writes LaTeX's backslashes and underscores unescaped. Inline math follows Pandoc's rule, so
// `$5 and $10` is not math: the opening `$` has a non-space after it, and the closing one has a non-space before it
// and no digit after it.
//----------------------------------------------------------------------------------------------------------------------

import { Decoration, type Editor, Extension, InputRule, Mark, Node } from '@tiptap/core';
import type { NodeType, Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

//----------------------------------------------------------------------------------------------------------------------

const INLINE_MATH = /^\$(?=[^\s$])(?:\\.|[^\\$\n])*?(?<=[^\s\\])\$(?!\d|\$)/u;
const TYPED_INLINE_MATH = /(?:^|[^$\\])(\$(?=[^\s$])(?:\\.|[^\\$\n])*?(?<=[^\s\\])\$)$/u;

// `$$` at the start of a line, through the `$$` that ends a line: on the same line, or on a later one when the
// opening line holds no other `$$`.
const MATH_BLOCK = /^ {0,3}\$\$(?:[^\n]*?\$\$|(?:(?!\$\$)[^\n])*\n[\s\S]*?\$\$)[ \t]*(?=\n|$)/u;
const MATH_BLOCK_START = /^ {0,3}\$\$/mu;
const TYPED_BLOCK_OPENING = /^\$\$\n$/u;
const TYPED_ONE_LINE_BLOCK = /^\$\$(?:(?!\$\$)[^\n])+\$\$$/u;

export function mathBlockLatex(source : string) : string
{
    return source.trim().replace(/^\$\$/u, '')
        .replace(/\$\$$/u, '')
        .trim();
}

export function inlineMathLatex(source : string) : string
{
    return source.replace(/^\$/u, '').replace(/\$$/u, '');
}

// A typed block replaces the paragraph it was typed in, when the paragraph holds nothing after the cursor and a math
// block can stand where it is (not as a list item's first line, say).
function isParagraphReplaceable($cursor : ResolvedPos, type : NodeType) : boolean
{
    const index = $cursor.index(-1);

    return $cursor.parent.type.name === 'paragraph'
        && $cursor.parentOffset === $cursor.parent.content.size
        && $cursor.node(-1).canReplaceWith(index, index + 1, type);
}

//----------------------------------------------------------------------------------------------------------------------
// Nodes
//----------------------------------------------------------------------------------------------------------------------

export const MathBlock = Node.create({
    name: 'mathBlock',
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,

    parseHTML()
    {
        return [ { tag: 'div[data-math-block]', preserveWhitespace: 'full' } ];
    },

    renderHTML()
    {
        return [ 'div', { 'data-math-block': '' }, [ 'pre', 0 ] ];
    },

    markdownTokenizer: {
        name: 'mathBlock',
        level: 'block',
        start: (src) => src.search(MATH_BLOCK_START),
        tokenize: (src) =>
        {
            const match = MATH_BLOCK.exec(src);
            return match ? { type: 'mathBlock', raw: match[0] } : undefined;
        },
    },

    parseMarkdown: (token, helpers) =>
    {
        return helpers.createNode('mathBlock', null, [ helpers.createTextNode(token.raw ?? '') ]);
    },

    renderMarkdown: (node) => (node.content ?? []).map((child) => child.text ?? '').join(''),

    // As in Typora, `$$` and Enter on an empty line starts a block with its closing `$$` already written, and the
    // cursor on the line between. `$$…$$` on a line of its own becomes a block as its closing `$$` is typed.
    addInputRules()
    {
        return [
            new InputRule({
                find: TYPED_BLOCK_OPENING,
                handler: ({ state, range }) =>
                {
                    const $cursor = state.doc.resolve(range.to);
                    if(!isParagraphReplaceable($cursor, this.type)) { return null; }

                    const start = $cursor.before();
                    state.tr.replaceWith(start, $cursor.after(), this.type.create(null, state.schema.text('$$\n\n$$')));
                    state.tr.setSelection(TextSelection.create(state.tr.doc, start + 1 + '$$\n'.length));
                },
            }),
            new InputRule({
                find: TYPED_ONE_LINE_BLOCK,
                handler: ({ state, range, match }) =>
                {
                    const $cursor = state.doc.resolve(range.to);
                    if(!isParagraphReplaceable($cursor, this.type)) { return null; }

                    const start = $cursor.before();
                    state.tr.replaceWith(start, $cursor.after(), this.type.create(null, state.schema.text(match[0])));
                    state.tr.setSelection(TextSelection.create(state.tr.doc, start + 1 + match[0].length));
                },
            }),
        ];
    },

    // The closing `$$` ends the block, so a new line after it is a line after the block.
    addKeyboardShortcuts()
    {
        return {
            Enter: ({ editor }) =>
            {
                const { $from, empty } = editor.state.selection;
                const source = $from.parent.textContent;
                const isAtClosedEnd = empty && $from.parent.type === this.type
                    && $from.parentOffset === $from.parent.content.size
                    && MATH_BLOCK.exec(source)?.[0] === source;

                return isAtClosedEnd && editor.commands.exitCode();
            },
        };
    },
});

export const InlineMath = Mark.create({
    name: 'inlineMath',
    code: true,
    excludes: '_',
    inclusive: false,

    parseHTML()
    {
        return [ { tag: 'span[data-inline-math]' } ];
    },

    renderHTML()
    {
        return [ 'span', { 'data-inline-math': '' }, 0 ];
    },

    markdownTokenizer: {
        name: 'inlineMath',
        level: 'inline',
        start: (src) => src.indexOf('$'),
        tokenize: (src) =>
        {
            const match = INLINE_MATH.exec(src);
            return match ? { type: 'inlineMath', raw: match[0] } : undefined;
        },
    },

    parseMarkdown: (token, helpers) => helpers.applyMark('inlineMath', [ helpers.createTextNode(token.raw ?? '') ]),

    renderMarkdown: (node, helpers) => helpers.renderChildren(node),

    // Math typed in Preview becomes math as its closing `$` is typed.
    addInputRules()
    {
        return [
            new InputRule({
                find: TYPED_INLINE_MATH,
                handler: ({ state, range, match }) =>
                {
                    const from = range.to - (match[1] ?? '').length;
                    if(state.doc.rangeHasMark(from, range.to, this.type)) { return null; }

                    state.tr.addMark(from, range.to, this.type.create());
                },
            }),
        ];
    },
});

//----------------------------------------------------------------------------------------------------------------------
// Inline display
//----------------------------------------------------------------------------------------------------------------------

export interface InlineMathRange
{
    from : number;
    to : number;
    source : string;
}

export function findInlineMath(doc : ProseMirrorNode) : InlineMathRange[]
{
    const ranges : InlineMathRange[] = [];
    doc.descendants((node, pos) =>
    {
        if(!node.isTextblock) { return true; }

        let run : InlineMathRange | null = null;
        node.forEach((child, offset) =>
        {
            const start = pos + 1 + offset;
            if(!child.isText || !child.marks.some((mark) => mark.type.name === 'inlineMath'))
            {
                run = null;
                return;
            }

            if(run?.to === start)
            {
                run.to += child.nodeSize;
                run.source += child.text ?? '';
                return;
            }

            run = { from: start, to: start + child.nodeSize, source: child.text ?? '' };
            ranges.push(run);
        });

        return false;
    });

    return ranges;
}

export interface InlineMathPreviewOptions
{
    // The widget drawn in place of a piece of inline math's source.
    widget : ((editor : Editor, pos : number, key : string, latex : string) => Decoration) | null;
}

// Each piece of inline math is drawn by the widget while the cursor is off it; touching either end of it shows its
// source, so arrowing up to math from either side opens it.
export const InlineMathPreview = Extension.create<InlineMathPreviewOptions>({
    name: 'inlineMathPreview',

    addOptions()
    {
        return { widget: null };
    },

    addDecorations()
    {
        return {
            shouldUpdate: ({ tr }) => tr.docChanged || tr.selectionSet,
            create: ({ editor, state }) =>
            {
                const { widget } = this.options;
                if(!widget) { return []; }

                const { from, to } = state.selection;
                return findInlineMath(state.doc).flatMap((range, index) =>
                {
                    if(editor.isEditable && from >= range.from && to <= range.to) { return []; }

                    return [
                        Decoration.Inline(range.from, range.to, { class: 'md-math-hidden' }),
                        widget(editor, range.from, `inline-math:${ index }`, inlineMathLatex(range.source)),
                    ];
                });
            },
        };
    },
});

//----------------------------------------------------------------------------------------------------------------------
