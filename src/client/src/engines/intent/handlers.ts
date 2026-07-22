//----------------------------------------------------------------------------------------------------------------------
// Handler Resolution
//
// The handler-resolution engine: given a node, which handler opens it -- edit (the in-app editor), native view (the
// browser's own inline renderer), or download. It is the registry the components/handlers/ families plug into: each
// family's handler gets first refusal at a file, and whatever no handler claims falls through to the browser's native
// open -- the permanent fallback, where an inline-renderable type (image, audio, video, PDF, JSON) previews in a new
// tab and the rest download. The in-app text family claims small text and markdown. Folders navigate; a resolved link
// follows its target under the same rules; a dead link opens to nothing. resolveOpen returns the intent rather than
// performing it, so the effectful half (router push, window.open) stays in the caller.
//----------------------------------------------------------------------------------------------------------------------

import type { NodeResponse } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const INLINE_PREFIXES = [ 'text/', 'image/', 'audio/', 'video/' ] as const;
const INLINE_EXACT = new Set([ 'application/pdf', 'application/json' ]);

const MARKDOWN_MIME = new Set([ 'text/markdown', 'text/x-markdown' ]);
const MARKDOWN_EXTENSIONS = [ '.md', '.markdown' ] as const;

// One 3.5-inch HD floppy, to the byte. If a text file won't fit on a floppy, you have no business hand-editing it in a
// browser -- open it in something that streams. Over this ceiling, editable types fall back to the native preview.
export const EDITOR_MAX_BYTES = 1_474_560;

export type EditorMode = 'markdown' | 'plain';

// navigate: a folder (or a link to one). edit: a small text/markdown file, opened in the in-app editor. view: an
// inline-renderable file, opened in a new tab. download: any other file, sent through the browser's save flow. none: a
// dead link, nothing to open.
export type OpenAction
    = | { kind : 'navigate'; folderID : string }
    | { kind : 'edit'; nodeID : string }
    | { kind : 'view'; nodeID : string }
    | { kind : 'download'; nodeID : string }
    | { kind : 'none' };

// The file facts a handler judges: a file node's own fields, or a link target's (whose mime and size are optional).
interface OpenTarget
{
    nodeID : string;
    mimeType : string;
    name : string;
    size : number;
}

//----------------------------------------------------------------------------------------------------------------------

export function canViewInline(mimeType : string) : boolean
{
    if(INLINE_EXACT.has(mimeType)) { return true; }

    return INLINE_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

// Markdown by declared type or by extension -- a .md the server typed as text/plain (or worse) is still markdown to us.
function isMarkdown(mimeType : string, name : string) : boolean
{
    if(MARKDOWN_MIME.has(mimeType)) { return true; }

    const lower = name.toLowerCase();
    return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

// A file the in-app editor can open: any text type, or markdown by type or extension, and small enough to hand-edit.
// Over the cap or any other type, it is left to the native renderer.
function isEditableText(target : OpenTarget) : boolean
{
    if(target.size > EDITOR_MAX_BYTES) { return false; }

    return target.mimeType.startsWith('text/') || isMarkdown(target.mimeType, target.name);
}

// The editor mode a file opens in by default: markdown when its type or extension says so, plain text otherwise. A
// per-open toggle overrides it; nothing here is persisted.
export function defaultEditorMode(mimeType : string, name : string) : EditorMode
{
    return isMarkdown(mimeType, name) ? 'markdown' : 'plain';
}

//----------------------------------------------------------------------------------------------------------------------
// Handler registry: each entry claims the files its family knows how to open, or returns null to pass. The first claim
// wins; anything unclaimed falls to the browser's native open. A new viewer (a PDF pane, an image lightbox) is a new
// entry here, not another branch in a widening conditional.
//----------------------------------------------------------------------------------------------------------------------

type OpenHandler = (target : OpenTarget) => OpenAction | null;

const HANDLERS : readonly OpenHandler[] = [
    (target) =>
    {
        return isEditableText(target) ? { kind: 'edit', nodeID: target.nodeID } : null;
    },
];

// The browser's own renderer, the fallback nothing overrides: inline-renderable types preview in a new tab, the rest
// download.
function nativeOpen(target : OpenTarget) : OpenAction
{
    return canViewInline(target.mimeType)
        ? { kind: 'view', nodeID: target.nodeID }
        : { kind: 'download', nodeID: target.nodeID };
}

function openFile(target : OpenTarget) : OpenAction
{
    for(const handle of HANDLERS)
    {
        const action = handle(target);
        if(action !== null) { return action; }
    }

    return nativeOpen(target);
}

export function resolveOpen(node : NodeResponse) : OpenAction
{
    if(node.type === 'folder') { return { kind: 'navigate', folderID: node.id }; }
    if(node.type === 'file')
    {
        return openFile({ nodeID: node.id, mimeType: node.mimeType, name: node.name, size: node.size });
    }

    if(node.target === null) { return { kind: 'none' }; }
    if(node.target.type === 'folder') { return { kind: 'navigate', folderID: node.target.id }; }

    return openFile({
        nodeID: node.target.id,
        mimeType: node.target.mimeType ?? '',
        name: node.target.name,
        size: node.target.size ?? 0,
    });
}

//----------------------------------------------------------------------------------------------------------------------
