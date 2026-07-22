//----------------------------------------------------------------------------------------------------------------------
// Editor Theme Registry
//
// The curated set of editor colorschemes the user picks from, each mapped to the CodeMirror extension that paints it.
// A theme owns the content area -- background and syntax -- while the app's own gutter chrome overlays it. The default
// is ayu-dark; a stored id the registry does not know resolves back to the default silently, so a preference written by
// a newer client (or a theme dropped from the set) never leaves the editor unstyled.
//----------------------------------------------------------------------------------------------------------------------

import type { Extension } from '@codemirror/state';
import { ayuDark, ayuLight } from 'codemirror-theme-ayu';
import {
    catppuccinMocha,
    githubDark,
    githubLight,
    gruvboxDark,
    gruvboxLight,
    materialLight,
    materialOcean,
    monokai,
    nord,
    solarizedDark,
    solarizedLight,
    tokyoNightStorm,
} from '@fsegurai/codemirror-theme-bundle';

// Constants
import { DEFAULT_EDITOR_THEME } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface EditorTheme
{
    id : string;
    label : string;
    dark : boolean;
    extension : Extension;
}

//----------------------------------------------------------------------------------------------------------------------

// The default sits first so the picker opens on it, and is held as its own binding so resolution never indexes an array
// that might be empty. Its id is bound to the shared default constant by the registry spec.
const defaultTheme : EditorTheme = { id: 'ayu-dark', label: 'Ayu Dark', dark: true, extension: ayuDark };

export const editorThemes : EditorTheme[] = [
    defaultTheme,
    { id: 'nord', label: 'Nord', dark: true, extension: nord },
    { id: 'tokyo-night', label: 'Tokyo Night', dark: true, extension: tokyoNightStorm },
    { id: 'github-dark', label: 'GitHub Dark', dark: true, extension: githubDark },
    { id: 'material-ocean', label: 'Material Ocean', dark: true, extension: materialOcean },
    { id: 'monokai', label: 'Monokai', dark: true, extension: monokai },
    { id: 'gruvbox-dark', label: 'Gruvbox Dark', dark: true, extension: gruvboxDark },
    { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', dark: true, extension: catppuccinMocha },
    { id: 'solarized-dark', label: 'Solarized Dark', dark: true, extension: solarizedDark },
    { id: 'ayu-light', label: 'Ayu Light', dark: false, extension: ayuLight },
    { id: 'github-light', label: 'GitHub Light', dark: false, extension: githubLight },
    { id: 'gruvbox-light', label: 'Gruvbox Light', dark: false, extension: gruvboxLight },
    { id: 'solarized-light', label: 'Solarized Light', dark: false, extension: solarizedLight },
    { id: 'material-light', label: 'Material Light', dark: false, extension: materialLight },
];

const themesByID = new Map(editorThemes.map((theme) => [ theme.id, theme ]));

//----------------------------------------------------------------------------------------------------------------------

// The registry's binding to the shared default: the default theme's id is the one the server resolves absent
// preferences to. A mismatch fails the registry spec rather than stranding the editor on an id nothing paints.
export const defaultEditorTheme : EditorTheme = themesByID.get(DEFAULT_EDITOR_THEME) ?? defaultTheme;

// A stored id (or none) resolved to a theme, falling back to the default when the id is unknown.
export function resolveEditorTheme(id : string | undefined) : EditorTheme
{
    return (id !== undefined ? themesByID.get(id) : undefined) ?? defaultEditorTheme;
}

// The picker's options: id and human label, in the curated order.
export const editorThemeOptions = editorThemes.map(({ id, label }) => ({ value: id, label }));

//----------------------------------------------------------------------------------------------------------------------
