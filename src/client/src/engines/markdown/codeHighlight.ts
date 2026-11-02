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

function highlightBlock(block : Node, pos : number, load : (description : LanguageDescription) => void) : Decoration[]
{
    const description = findCodeLanguage(block.attrs.language as string | null);
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
        if(node.type.name !== 'codeBlock') { return !node.isTextblock; }

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
