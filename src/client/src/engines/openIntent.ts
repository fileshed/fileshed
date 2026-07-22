//----------------------------------------------------------------------------------------------------------------------
// Open Intent
//
// The single place that decides how a node opens. The browser's own renderer is the product's default handler: a file
// whose mime type the browser can display (text, images, audio, video, PDF, JSON) opens inline in a new tab; anything
// else falls through to the attachment download. Folders navigate; a resolved link follows its target under the same
// rule; a dead link opens to nothing. resolveOpen returns the intent rather than performing it, so the effectful half
// (router push, window.open) stays in the caller and a future handler registry -- viewers and editors alike -- can wrap
// this one decision.
//----------------------------------------------------------------------------------------------------------------------

import type { NodeResponse } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const INLINE_PREFIXES = [ 'text/', 'image/', 'audio/', 'video/' ] as const;
const INLINE_EXACT = new Set([ 'application/pdf', 'application/json' ]);

// navigate: a folder (or a link to one). view: an inline-renderable file, opened in a new tab. download: any other
// file, sent through the browser's save flow. none: a dead link, nothing to open.
export type OpenAction
    = | { kind : 'navigate'; folderID : string }
    | { kind : 'view'; nodeID : string }
    | { kind : 'download'; nodeID : string }
    | { kind : 'none' };

//----------------------------------------------------------------------------------------------------------------------

export function canViewInline(mimeType : string) : boolean
{
    if(INLINE_EXACT.has(mimeType)) { return true; }

    return INLINE_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

function openFile(nodeID : string, mimeType : string) : OpenAction
{
    return canViewInline(mimeType) ? { kind: 'view', nodeID } : { kind: 'download', nodeID };
}

export function resolveOpen(node : NodeResponse) : OpenAction
{
    if(node.type === 'folder') { return { kind: 'navigate', folderID: node.id }; }
    if(node.type === 'file') { return openFile(node.id, node.mimeType); }

    if(node.target === null) { return { kind: 'none' }; }
    if(node.target.type === 'folder') { return { kind: 'navigate', folderID: node.target.id }; }

    return openFile(node.target.id, node.target.mimeType ?? '');
}

//----------------------------------------------------------------------------------------------------------------------
