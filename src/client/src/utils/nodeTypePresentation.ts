//----------------------------------------------------------------------------------------------------------------------
// Node Type Presentation
//
// The single source of how a node type reads on screen: per-family label, lucide icon, and Tailwind text-colour. The
// grid tiles, the list rows, and the Type filter dropdown all draw from this one table, so a family looks the same
// wherever it appears. A file classifies through core's familyOfMimeType (the same map the server filters by),
// except playlists, which core's isPlaylistFile carves out of the audio family so they read as their own kind; a
// folder is the folders family; a link borrows its target's presentation; an unclassified file gets a neutral glyph
// and a dead link the dimmed broken glyph.
//----------------------------------------------------------------------------------------------------------------------

import {
    type NodeResponse,
    type NodeTypeFamily,
    type SharedTarget,
    familyOfMimeType,
    isPlaylistFile,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface NodeTypePresentation
{
    label : string;
    noun : string;
    icon : string;
    color : string;
}

// label is the plural filter-menu form; noun is the singular a single node's Type column reads.
const FAMILY_PRESENTATION : Readonly<Record<NodeTypeFamily, NodeTypePresentation>> = {
    folders: { label: 'Folders', noun: 'Folder', icon: 'i-lucide-folder', color: 'text-amber-500' },
    documents: { label: 'Documents', noun: 'Document', icon: 'i-lucide-file-text', color: 'text-blue-500' },
    pdfs: { label: 'PDFs', noun: 'PDF', icon: 'i-lucide-file-type', color: 'text-red-500' },
    images: { label: 'Images', noun: 'Image', icon: 'i-lucide-image', color: 'text-emerald-500' },
    video: { label: 'Video', noun: 'Video', icon: 'i-lucide-video', color: 'text-rose-500' },
    playlists: { label: 'Playlists', noun: 'Playlist', icon: 'i-lucide-list-music', color: 'text-fuchsia-500' },
    audio: { label: 'Audio', noun: 'Audio', icon: 'i-lucide-music', color: 'text-violet-500' },
    archives: { label: 'Archives', noun: 'Archive', icon: 'i-lucide-file-archive', color: 'text-stone-500' },
    links: { label: 'Links', noun: 'Link', icon: 'i-lucide-link', color: 'text-cyan-500' },
};

// A file whose mime maps to no family: a generic glyph, muted rather than coloured.
const NEUTRAL_PRESENTATION : NodeTypePresentation
    = { label: 'File', noun: 'File', icon: 'i-lucide-file', color: 'text-muted' };

// Playlists sit inside the audio mime family but read as their own thing -- in a folder of tracks, the icon and the
// Type column are what tell a playlist from a song.
const PLAYLIST_PRESENTATION : NodeTypePresentation
    = { label: 'Playlists', noun: 'Playlist', icon: 'i-lucide-list-music', color: 'text-fuchsia-500' };

// A link with a null target: the broken glyph, dimmed. Tiles and rows fade it further via isDeadLink.
const DEAD_LINK_PRESENTATION : NodeTypePresentation
    = { label: 'Broken link', noun: 'Broken link', icon: 'i-lucide-unlink', color: 'text-dimmed' };

//----------------------------------------------------------------------------------------------------------------------

export function familyPresentation(family : NodeTypeFamily) : NodeTypePresentation
{
    return FAMILY_PRESENTATION[family];
}

function fileMimePresentation(mimeType : string, name : string) : NodeTypePresentation
{
    if(isPlaylistFile(mimeType, name)) { return PLAYLIST_PRESENTATION; }

    const family = familyOfMimeType(mimeType);
    return family === null ? NEUTRAL_PRESENTATION : FAMILY_PRESENTATION[family];
}

// A link with a null target -- the row it pointed at is gone, or access was lost. Rendered dimmed with a broken glyph.
export function isDeadLink(node : NodeResponse) : boolean
{
    return node.type === 'link' && node.target === null;
}

export function nodePresentation(node : NodeResponse) : NodeTypePresentation
{
    switch (node.type)
    {
        case 'folder':
            return FAMILY_PRESENTATION.folders;

        case 'file':
            return fileMimePresentation(node.mimeType, node.name);

        case 'link':
            if(node.target === null) { return DEAD_LINK_PRESENTATION; }

            return node.target.type === 'folder'
                ? FAMILY_PRESENTATION.folders
                : fileMimePresentation(node.target.mimeType ?? '', node.target.name);
    }
}

// A Shared-with-me target reads the same as the node it is: a folder as the folders family, a file by its mime. A share
// only ever targets a file or folder, so there is no link case to render.
export function sharedTargetPresentation(target : SharedTarget) : NodeTypePresentation
{
    return target.type === 'folder'
        ? FAMILY_PRESENTATION.folders
        : fileMimePresentation(target.mimeType ?? '', target.name);
}

// The Type column's label: a dead link reads its own broken-glyph noun, a resolved link reads "Link" -- what the Links
// filter matches -- never its target's family, which would make the column and the filter disagree about the same
// node. Every other node reads its own family noun.
export function nodeKindLabel(node : NodeResponse) : string
{
    if(isDeadLink(node)) { return nodePresentation(node).noun; }
    if(node.type === 'link') { return familyPresentation('links').noun; }

    return nodePresentation(node).noun;
}

//----------------------------------------------------------------------------------------------------------------------
