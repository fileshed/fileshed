//----------------------------------------------------------------------------------------------------------------------
// Handler Resolution
//
// The handler-resolution engine: given a node, which handler opens it -- edit (text/markdown editors), annotate (the
// PDF annotator), play (the media players), native view (the browser's own inline renderer), or download. It is the
// registry the components/handlers/ families plug into: each family's handler gets first refusal at a file, and
// whatever no handler claims falls through to the browser's native open -- the permanent fallback, where an
// inline-renderable type previews in a new tab and the rest download. Folders navigate; a link to a folder navigates
// to the LINK's own id (so its logical placement shows, not the target's ancestry), a link to a file follows the
// target under the file rules, and a dead link opens to nothing. resolveOpen returns the intent rather than performing
// it, so the effectful half (router push, window.open) stays in the caller.
//----------------------------------------------------------------------------------------------------------------------

import { type NodeResponse, PDF_ANNOTATOR_MAX_BYTES, type SharedTarget } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const INLINE_PREFIXES = [ 'text/', 'image/', 'audio/', 'video/' ] as const;
const INLINE_EXACT = new Set([ 'application/pdf', 'application/json' ]);

const MARKDOWN_MIME = new Set([ 'text/markdown', 'text/x-markdown' ]);
const MARKDOWN_EXTENSIONS = [ '.md', '.markdown' ] as const;

// One 3.5-inch HD floppy, to the byte. If a text file won't fit on a floppy, you have no business hand-editing it in a
// browser -- open it in something that streams. Over this ceiling, editable types fall back to the native preview.
export const EDITOR_MAX_BYTES = 1_474_560;

export type EditorMode = 'markdown' | 'plain';

// navigate: a folder (or a link to one). edit: a small text/markdown file, opened in the in-app editor. annotate: a
// PDF under the annotator's cap, opened in the in-app annotator. play: audio or video, opened in the in-app player.
// view: an inline-renderable file, opened in a new tab. download: any other file, sent through the browser's save
// flow. none: a dead link, nothing to open.
export type OpenAction
    = | { kind : 'navigate'; folderID : string }
    | { kind : 'edit'; nodeID : string }
    | { kind : 'annotate'; nodeID : string }
    | { kind : 'play'; nodeID : string; media : 'video' | 'audio' }
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

    // The pdf family annotates, it never edits page content; an over-cap PDF falls through to the native preview,
    // which renders lazily without holding a whole resident copy.
    (target) =>
    {
        return target.mimeType === 'application/pdf' && target.size <= PDF_ANNOTATOR_MAX_BYTES
            ? { kind: 'annotate', nodeID: target.nodeID }
            : null;
    },

    (target) =>
    {
        return target.mimeType.startsWith('video/')
            ? { kind: 'play', nodeID: target.nodeID, media: 'video' }
            : null;
    },

    (target) =>
    {
        return target.mimeType.startsWith('audio/')
            ? { kind: 'play', nodeID: target.nodeID, media: 'audio' }
            : null;
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

    // A folder link navigates to the LINK's own id, not the target's: the URL then carries the link, so the breadcrumb
    // walks the link's own placement (My Files > ... > link name) instead of the target's real ancestry, which the
    // caller may not even be able to reach. A link to a FILE still follows the target -- its bytes are what open.
    if(node.target.type === 'folder') { return { kind: 'navigate', folderID: node.id }; }

    return openFile({
        nodeID: node.target.id,
        mimeType: node.target.mimeType ?? '',
        name: node.target.name,
        size: node.target.size ?? 0,
    });
}

// Opening an item from Shared with me: a shared folder navigates into itself (the server's effective-role machinery
// permits the read), a shared file resolves through the same handler registry as any file. A share only ever targets a
// file or folder -- links carry no ACL to share -- so a link target opens to nothing.
export function resolveSharedOpen(target : SharedTarget) : OpenAction
{
    if(target.type === 'folder') { return { kind: 'navigate', folderID: target.id }; }
    if(target.type === 'file')
    {
        return openFile({
            nodeID: target.id,
            mimeType: target.mimeType ?? '',
            name: target.name,
            size: target.size ?? 0,
        });
    }

    return { kind: 'none' };
}

//----------------------------------------------------------------------------------------------------------------------
