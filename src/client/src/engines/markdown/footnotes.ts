//----------------------------------------------------------------------------------------------------------------------
// Markdown Footnotes
//
// A definition stays where the file has it, so the file keeps its order. Preview draws each top-level definition at
// the end of the page by giving it a flex order: the number of its first reference, or a place after the numbered
// ones when nothing references it. As on GitHub, a reference is numbered only when its label has a definition.
//----------------------------------------------------------------------------------------------------------------------

import { Decoration, Extension, type JSONContent, type MarkdownRendererHelpers, Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// Engines
import { joinBlocks } from './lineModel.ts';

//----------------------------------------------------------------------------------------------------------------------

declare module '@tiptap/core'
{
    interface Commands<ReturnType>
    {
        footnotes : {
            insertFootnote : () => ReturnType;
        };
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Numbering
//----------------------------------------------------------------------------------------------------------------------

// Each label's number, in the order of the first reference to it. Labels nothing references, and references without
// a definition, get none.
export function numberFootnotes(references : string[], definitions : string[]) : Map<string, number>
{
    const defined = new Set(definitions);
    const numbers = new Map<string, number>();
    for(const label of references)
    {
        if(defined.has(label) && !numbers.has(label)) { numbers.set(label, numbers.size + 1); }
    }

    return numbers;
}

interface FootnoteDefinitionAt
{
    pos : number;
    node : ProseMirrorNode;
    topLevel : boolean;
}

interface FootnoteScan
{
    references : { pos : number; label : string }[];

    // The first definition of each label, which is the one that counts.
    definitions : Map<string, FootnoteDefinitionAt>;
}

function labelOf(node : ProseMirrorNode) : string
{
    return node.attrs.label as string;
}

function scanFootnotes(doc : ProseMirrorNode) : FootnoteScan
{
    const scan : FootnoteScan = { references: [], definitions: new Map() };
    doc.descendants((node, pos, parent) =>
    {
        if(node.type.name === 'footnoteReference') { scan.references.push({ pos, label: labelOf(node) }); }
        if(node.type.name === 'footnoteDefinition' && !scan.definitions.has(labelOf(node)))
        {
            scan.definitions.set(labelOf(node), { pos, node, topLevel: parent === doc });
        }

        return true;
    });

    return scan;
}

//----------------------------------------------------------------------------------------------------------------------
// Markdown
//----------------------------------------------------------------------------------------------------------------------

const LABEL = String.raw`[^\]\s^]+`;
const REFERENCE = new RegExp(String.raw`^\[\^(${ LABEL })\]`, 'u');
const DEFINITION = new RegExp(String.raw`^ {0,3}\[\^(${ LABEL })\]:[ \t]?([^\n]*)`, 'u');
const DEFINITION_START = /^ {0,3}\[\^/mu;
const CONTINUATION = /^(?: {4}|\t)/u;
const INDENT = '    ';

export interface FootnoteDefinitionMatch
{
    raw : string;
    label : string;

    // The definition's markdown, with the label and the continuation lines' indent taken off.
    content : string;
}

// A definition runs on through the indented lines under it and the blank lines between them. A line that isn't
// indented ends it, as does the end of the indented lines: blank lines after the last one aren't the definition's.
export function matchFootnoteDefinition(src : string) : FootnoteDefinitionMatch | null
{
    const first = DEFINITION.exec(src);
    if(!first) { return null; }

    const lines = [ first[2] ?? '' ];
    const nextLine = /\n([^\n]*)/uy;
    let end = first[0].length;
    let blanks : string[] = [];

    nextLine.lastIndex = end;
    for(let match = nextLine.exec(src); match; match = nextLine.exec(src))
    {
        const line = match[1] ?? '';
        if(line.trim() === '') { blanks.push(''); }
        else if(CONTINUATION.test(line))
        {
            lines.push(...blanks, line.replace(CONTINUATION, ''));
            blanks = [];
            end = nextLine.lastIndex;
        }
        else { break; }
    }

    return { raw: src.slice(0, end), label: first[1] ?? '', content: lines.join('\n') };
}

function stringField(token : object, field : string) : string
{
    const value : unknown = (token as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : '';
}

// The label on the first line and the rest indented under it; blank lines stay bare.
function renderDefinition(node : JSONContent, helpers : MarkdownRendererHelpers) : string
{
    const label = (node.attrs?.label as string | undefined) ?? '';
    const [ first = '', ...rest ] = joinBlocks(node.content ?? [], helpers).split('\n');
    const head = first === '' ? `[^${ label }]:` : `[^${ label }]: ${ first }`;

    return [ head, ...rest.map((line) => { return line === '' ? '' : `${ INDENT }${ line }`; }) ].join('\n');
}

//----------------------------------------------------------------------------------------------------------------------
// Nodes
//----------------------------------------------------------------------------------------------------------------------

export const FootnoteReference = Node.create({
    name: 'footnoteReference',
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes()
    {
        return { label: { default: '' } };
    },

    parseHTML()
    {
        return [ {
            tag: 'sup[data-footnote-ref]',
            getAttrs: (element) => ({ label: element.getAttribute('data-label') ?? '' }),
        } ];
    },

    renderHTML({ node })
    {
        return [ 'sup', { 'data-footnote-ref': '', 'data-label': labelOf(node) } ];
    },

    markdownTokenizer: {
        name: 'footnoteReference',
        level: 'inline',
        start: (src) => src.indexOf('[^'),
        tokenize: (src) =>
        {
            const match = REFERENCE.exec(src);
            return match ? { type: 'footnoteReference', raw: match[0], label: match[1] } : undefined;
        },
    },

    parseMarkdown: (token, helpers) => helpers.createNode('footnoteReference', { label: stringField(token, 'label') }),

    renderMarkdown: (node) => `[^${ (node.attrs?.label as string | undefined) ?? '' }]`,
});

export const FootnoteDefinition = Node.create({
    name: 'footnoteDefinition',
    group: 'block',
    content: 'block+',
    defining: true,

    addAttributes()
    {
        return { label: { default: '' } };
    },

    parseHTML()
    {
        return [ {
            tag: 'div[data-footnote-definition]',
            getAttrs: (element) => ({ label: element.getAttribute('data-label') ?? '' }),
        } ];
    },

    renderHTML({ node })
    {
        return [ 'div', { 'data-footnote-definition': '', 'data-label': labelOf(node) }, 0 ];
    },

    markdownTokenizer: {
        name: 'footnoteDefinition',
        level: 'block',
        start: (src) => src.search(DEFINITION_START),
        tokenize: (src, _tokens, lexer) =>
        {
            const match = matchFootnoteDefinition(src);
            if(!match) { return undefined; }

            return {
                type: 'footnoteDefinition',
                raw: match.raw,
                label: match.label,
                tokens: lexer.blockTokens(match.content),
            };
        },
    },

    parseMarkdown: (token, helpers) =>
    {
        const content = helpers.parseChildren(token.tokens ?? []);

        return helpers.createNode(
            'footnoteDefinition',
            { label: stringField(token, 'label') },
            content.length > 0 ? content : [ { type: 'paragraph' } ]
        );
    },

    renderMarkdown: renderDefinition,

    // A new footnote takes the first free number as its label. Its definition goes at the end of the document after a
    // blank line, which GitHub needs between a paragraph and a definition, and the cursor goes into it.
    addCommands()
    {
        return {
            insertFootnote: () => ({ state, tr, dispatch }) =>
            {
                const { paragraph, footnoteReference } = state.schema.nodes;
                const { parent } = state.selection.$from;
                if(!paragraph || !footnoteReference || !parent.inlineContent || parent.type.spec.code) { return false; }
                if(!dispatch) { return true; }

                const scan = scanFootnotes(state.doc);
                const taken = new Set([ ...scan.definitions.keys(), ...scan.references.map(({ label }) => label) ]);
                let number = 1;
                while(taken.has(String(number))) { number += 1; }
                const label = String(number);

                tr.replaceSelectionWith(footnoteReference.create({ label }), false);

                const end = tr.doc.content.size;
                const last = tr.doc.lastChild;
                const endsBlank = last?.type === paragraph && last.content.size === 0;
                const spacer = endsBlank ? [] : [ paragraph.create() ];
                tr.insert(end, [ ...spacer, this.type.create({ label }, paragraph.create()) ]);

                const definitionAt = end + (endsBlank ? 0 : 2);
                tr.setSelection(TextSelection.near(tr.doc.resolve(definitionAt + 1))).scrollIntoView();

                return true;
            },
        };
    },
});

//----------------------------------------------------------------------------------------------------------------------
// Display
//----------------------------------------------------------------------------------------------------------------------

function jumpTo(view : EditorView, pos : number) : void
{
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).scrollIntoView());
    view.focus();
}

// The link at the end of a definition's first line, back to the first reference to it.
function backLink(label : string) : (view : EditorView) => HTMLElement
{
    return (view) =>
    {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'md-footnote-back';
        link.contentEditable = 'false';
        // The text presentation selector, or the arrow draws as an emoji.
        link.textContent = '↩︎';
        link.title = 'Back to the reference';
        link.setAttribute('aria-label', link.title);
        link.addEventListener('mousedown', (event) =>
        {
            event.preventDefault();

            const reference = scanFootnotes(view.state.doc).references.find((entry) => entry.label === label);
            if(reference) { jumpTo(view, reference.pos); }
        });

        return link;
    };
}

interface PlacedDefinition
{
    label : string;
    number : number | undefined;
    order : number;
    at : FootnoteDefinitionAt;
}

// The definition drawn first at the end of the page carries the divider above the footnotes.
function definitionAttributes(placed : PlacedDefinition, first : boolean) : Record<string, string>
{
    const attributes : Record<string, string> = {};
    if(placed.number !== undefined) { attributes['data-number'] = String(placed.number); }
    if(placed.at.topLevel) { attributes.style = `order: ${ placed.order }`; }
    if(first) { attributes.class = 'md-footnotes-start'; }

    return attributes;
}

function footnoteDecorations(doc : ProseMirrorNode) : Decoration[]
{
    const { references, definitions } = scanFootnotes(doc);
    const numbers = numberFootnotes(references.map(({ label }) => label), [ ...definitions.keys() ]);
    const decorations : Decoration[] = [];

    for(const { pos, label } of references)
    {
        const number = numbers.get(label);
        const definition = definitions.get(label);
        if(number !== undefined && definition)
        {
            decorations.push(Decoration.Node(pos, pos + 1, {
                'data-number': String(number),
                'title': definition.node.textBetween(0, definition.node.content.size, ' '),
                'aria-label': `Footnote ${ number }`,
            }));
        }
    }

    let unnumbered = numbers.size;
    const placed = [ ...definitions ].map(([ label, at ]) : PlacedDefinition =>
    {
        const number = numbers.get(label);
        unnumbered += number === undefined ? 1 : 0;

        return { label, number, order: number ?? unnumbered, at };
    });
    const firstOrder = Math.min(...placed.filter(({ at }) => at.topLevel).map(({ order }) => order));

    for(const entry of placed)
    {
        const { at, label, number, order } = entry;
        const first = at.topLevel && order === firstOrder;
        decorations.push(Decoration.Node(at.pos, at.pos + at.node.nodeSize, definitionAttributes(entry, first)));

        const firstLine = at.node.firstChild;
        if(number !== undefined && firstLine?.isTextblock)
        {
            const lineEnd = at.pos + 1 + firstLine.nodeSize - 1;
            decorations.push(Decoration.Widget(lineEnd, backLink(label), { key: `footnote-back:${ label }`, side: 1 }));
        }
    }

    return decorations;
}

// Choosing a reference goes to its definition.
export const FootnoteDisplay = Extension.create({
    name: 'footnoteDisplay',

    addDecorations()
    {
        return {
            create: ({ state }) => footnoteDecorations(state.doc),
        };
    },

    addProseMirrorPlugins()
    {
        return [
            new Plugin({
                props: {
                    handleClickOn: (view, _pos, node, _nodePos, _event, direct) =>
                    {
                        if(!direct || node.type.name !== 'footnoteReference') { return false; }

                        const definition = scanFootnotes(view.state.doc).definitions.get(labelOf(node));
                        if(!definition) { return false; }

                        jumpTo(view, definition.pos + 1);
                        return true;
                    },
                },
            }),
        ];
    },
});

//----------------------------------------------------------------------------------------------------------------------
