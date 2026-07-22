//----------------------------------------------------------------------------------------------------------------------
// Editor Theme Registry — resolution and composition
//
// The registry maps a stored colorscheme id to the CodeMirror extension that paints it. Its contract: the default is
// ayu-dark and is bound to the shared default constant; an unknown or absent id resolves to that default rather than
// leaving the editor unstyled; and every curated entry is a real, composable extension. Colors are a browser concern
// and are not asserted here.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { EditorState } from '@codemirror/state';
import { DEFAULT_EDITOR_THEME } from '@fileshed/core';

// Under test
import {
    defaultEditorTheme,
    editorThemeOptions,
    editorThemes,
    resolveEditorTheme,
} from '@client/components/handlers/text/themeRegistry.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('resolveEditorTheme', () =>
{
    it('resolves an absent id to the default theme', () =>
    {
        expect(resolveEditorTheme(undefined).id).toBe(DEFAULT_EDITOR_THEME);
    });

    it('resolves an unknown or stale id to the default theme rather than stranding the editor', () =>
    {
        expect(resolveEditorTheme('a-theme-that-was-dropped').id).toBe(DEFAULT_EDITOR_THEME);
    });

    it('resolves a known id to that theme', () =>
    {
        expect(resolveEditorTheme('nord').id).toBe('nord');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('editorThemes registry', () =>
{
    it('binds the default theme to the shared default constant', () =>
    {
        expect(defaultEditorTheme.id).toBe(DEFAULT_EDITOR_THEME);
    });

    it('ships ayu-dark as a dark default', () =>
    {
        const ayu = editorThemes.find((theme) => theme.id === 'ayu-dark');

        expect(ayu?.dark).toBe(true);
        expect(DEFAULT_EDITOR_THEME).toBe('ayu-dark');
    });

    it('offers both dark and light choices', () =>
    {
        expect(editorThemes.some((theme) => theme.dark)).toBe(true);
        expect(editorThemes.some((theme) => !theme.dark)).toBe(true);
    });

    it('composes every entry into an editor state', () =>
    {
        for(const theme of editorThemes)
        {
            const state = EditorState.create({ doc: 'x', extensions: [ theme.extension ] });

            expect(state.doc.toString()).toBe('x');
        }
    });

    it('exposes one picker option per theme, carrying id and label', () =>
    {
        expect(editorThemeOptions).toEqual(editorThemes.map(({ id, label }) => ({ value: id, label })));
    });
});

//----------------------------------------------------------------------------------------------------------------------
