//----------------------------------------------------------------------------------------------------------------------
// Editor Chrome — extension composition
//
// The chrome maps the editor's structural surfaces and its gutter to Nuxt UI's CSS variables, so its colors can only be
// judged in a browser. What a unit test can guard is that the module still composes: that the chrome is a valid theme
// extension. A malformed style spec fails here. (The hand-maintained markdown highlighting this module once carried was
// removed when the syntax palette became the chosen colorscheme's job -- there is no export left to exercise.)
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { EditorState } from '@codemirror/state';

// Under test
import { editorChrome } from '@client/components/handlers/text/chrome.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('editorChrome', () =>
{
    it('composes into an editor state as a valid theme extension', () =>
    {
        const state = EditorState.create({
            doc: '# heading',
            extensions: [ editorChrome() ],
        });

        expect(state.doc.toString()).toBe('# heading');
    });
});

//----------------------------------------------------------------------------------------------------------------------
