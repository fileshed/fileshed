//----------------------------------------------------------------------------------------------------------------------
// Editor Chrome
//
// The app-native surfaces of the editor, kept out of the chosen colorscheme's hands: the structural layout (height,
// mono font, line height, padding) and the gutter, styled from Nuxt UI's CSS custom properties so it tracks the app's
// own light/dark mode rather than the theme. It carries no baked color mode -- the variables resolve per mode on their
// own -- and it must outrank the theme wherever both style the gutter, which the caller arranges with Prec.high. The
// content area (background, syntax, selection, caret) is left entirely to the chosen theme.
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
