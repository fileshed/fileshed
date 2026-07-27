//----------------------------------------------------------------------------------------------------------------------
// Scope Catalog
//
// The presentation vocabulary for the six scopes: labels, plain-language descriptions, and the danger flag the UI
// badges. The presets are buttons, not stored scopes -- they tick real checkboxes, so a key's row always shows its
// true capabilities and a "full access" key minted today never silently grows scopes added later.
//----------------------------------------------------------------------------------------------------------------------

import type { AccessTokenScope } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface ScopeEntry
{
    scope : AccessTokenScope;
    label : string;
    description : string;
    danger : boolean;
}

export const scopeCatalog : ScopeEntry[] = [
    {
        scope: 'files:download',
        label: 'Download files',
        description: 'Fetch the bytes of files you can read, by ID. No browsing or listing.',
        danger: false,
    },
    {
        scope: 'files:read',
        label: 'Read files',
        description: 'Browse and search the drive: listings, file details, trash, shared with you — plus download.',
        danger: false,
    },
    {
        scope: 'files:write',
        label: 'Read & write files',
        description: 'Everything read allows, plus upload, create folders, rename, move, replace content, and '
            + 'trash/restore. Never permanent deletion — that always needs a signed-in browser.',
        danger: false,
    },
    {
        scope: 'shares:read',
        label: 'Read sharing',
        description: 'See who files are shared with, existing public links, and pending access requests.',
        danger: false,
    },
    {
        scope: 'shares:write',
        label: 'Manage sharing',
        description: 'Grant and revoke shares, resolve access requests — and create public links, which make files '
            + 'readable by anyone holding the link.',
        danger: true,
    },
    {
        scope: 'account:read',
        label: 'Read account',
        description: 'Your profile and storage usage.',
        danger: false,
    },
];

//----------------------------------------------------------------------------------------------------------------------

export const fullAccessPreset : AccessTokenScope[]
    = [ 'files:write', 'shares:write', 'account:read' ];

export const readOnlyPreset : AccessTokenScope[]
    = [ 'files:read', 'shares:read', 'account:read' ];

//----------------------------------------------------------------------------------------------------------------------
