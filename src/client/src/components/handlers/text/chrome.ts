//----------------------------------------------------------------------------------------------------------------------
// Editor Chrome
//
// The structural layout and the gutter are styled from Nuxt UI's CSS custom properties, so they follow the app's
// light/dark mode rather than the chosen colorscheme; the content area is left entirely to the theme. This must outrank
// the theme wherever both style the gutter, which the caller arranges with Prec.high.
//----------------------------------------------------------------------------------------------------------------------

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

//----------------------------------------------------------------------------------------------------------------------

export function editorChrome() : Extension
{
    return EditorView.theme({
        '&': {
            height: '100%',
            fontSize: '0.875rem',
        },
        '.cm-scroller': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            lineHeight: '1.6',
            overflow: 'auto',
        },
        '.cm-content': { padding: '0.75rem 0' },
        '&.cm-focused': { outline: 'none' },

        '.cm-gutters': {
            backgroundColor: 'var(--ui-bg-muted)',
            color: 'var(--ui-text-dimmed)',
            border: 'none',
            borderRight: '1px solid var(--ui-border)',
        },
        '.cm-activeLineGutter': {
            backgroundColor: 'var(--ui-bg-elevated)',
            color: 'var(--ui-text-muted)',
        },
    });
}

//----------------------------------------------------------------------------------------------------------------------
