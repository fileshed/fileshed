//----------------------------------------------------------------------------------------------------------------------
// Code Highlighting
//
// Grammars load on first use. A block whose grammar is still loading is drawn plain, and the whole document is
// highlighted again once it arrives.
//----------------------------------------------------------------------------------------------------------------------

import { Decoration, Extension } from '@tiptap/core';
import type { LanguageDescription } from '@codemirror/language';
import type { Node } from '@tiptap/pm/model';
import { classHighlighter, highlightTree } from '@lezer/highlight';

// Engines
import { findCodeLanguage } from './codeLanguages.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface HighlightedPiece
{
    text : string;
    classes : string;
}

function languageOf(block : Node) : string | null
{
    if(block.type.name === 'htmlBlock') { return 'html'; }
    if(block.type.name === 'mathBlock') { return 'latex'; }

    return block.type.name === 'codeBlock' ? block.attrs.language as string | null : null;
}

// Code split into the pieces its highlighting colors, for code drawn outside a code block.
export async function highlightCode(code : string, language : string) : Promise<HighlightedPiece[]>
{
    const description = findCodeLanguage(language);
    if(description === null) { return [ { text: code, classes: '' } ]; }

    const support = description.support ?? await description.load();
    const pieces : HighlightedPiece[] = [];
    let at = 0;
    highlightTree(support.language.parser.parse(code), classHighlighter, (from, to, classes) =>
    {
        if(from > at) { pieces.push({ text: code.slice(at, from), classes: '' }); }
        pieces.push({ text: code.slice(from, to), classes });
        at = to;
    });
    if(at < code.length) { pieces.push({ text: code.slice(at), classes: '' }); }

    return pieces;
}

function highlightBlock(block : Node, pos : number, load : (description : LanguageDescription) => void) : Decoration[]
{
    const description = findCodeLanguage(languageOf(block));
    if(description === null) { return []; }
    if(!description.support)
    {
        load(description);
        return [];
    }

    // A code block holds plain text only, so an offset into its text is an offset from the block's content start.
    const start = pos + 1;
    const decorations : Decoration[] = [];
    highlightTree(description.support.language.parser.parse(block.textContent), classHighlighter, (from, to, classes) =>
    {
        decorations.push(Decoration.Inline(start + from, start + to, { class: classes }));
    });

    return decorations;
}

function highlightBetween(
    doc : Node,
    from : number,
    to : number,
    load : (description : LanguageDescription) => void
) : Decoration[]
{
    const decorations : Decoration[] = [];
    doc.nodesBetween(from, to, (node, pos) =>
    {
        if(!node.type.spec.code) { return !node.isTextblock; }

        decorations.push(...highlightBlock(node, pos, load));
        return false;
    });

    return decorations;
}

//----------------------------------------------------------------------------------------------------------------------

export const CodeHighlight = Extension.create({
    name: 'codeHighlight',

    addDecorations()
    {
        const loading = new Set<LanguageDescription>();
        const load = (description : LanguageDescription) : void =>
        {
            if(loading.has(description)) { return; }

            loading.add(description);
            description.load()
                .then(() =>
                {
                    if(!this.editor.isDestroyed) { this.editor.commands.updateDecorations(this.name); }
                })
                // A grammar that fails to load leaves its blocks plain, and the next edit to one asks again.
                .catch(() => undefined)
                .finally(() => loading.delete(description));
        };

        return {
            update: 'changedRanges',
            create: ({ state }) => highlightBetween(state.doc, 0, state.doc.content.size, load),
            createInRange: ({ state, from, to }) => highlightBetween(state.doc, from, to, load),
        };
    },
});

//----------------------------------------------------------------------------------------------------------------------
