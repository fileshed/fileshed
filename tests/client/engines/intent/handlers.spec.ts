//----------------------------------------------------------------------------------------------------------------------
// Native Viewer
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    EDITOR_MAX_BYTES,
    type LinkTarget,
    type NodeResponse,
    PDF_ANNOTATOR_MAX_BYTES,
    type Role,
    type SharedTarget,
} from '@fileshed/core';

import { canViewInline, defaultEditorMode, resolveOpen, resolveSharedOpen } from '@client/engines/intent/handlers.ts';

//----------------------------------------------------------------------------------------------------------------------

const BASE = {
    id: 'n1',
    name: 'thing',
    ownerID: 'u1',
    parentID: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    role: 'owner' as const,
};

function file(id : string, mimeType : string) : NodeResponse
{
    return { ...BASE, id, type: 'file', blobID: 'b1', size: 10, mimeType, trashedAt: null };
}

function fileOf(fields : { mimeType : string; name ?: string; size ?: number; role ?: Role }) : NodeResponse
{
    return {
        ...BASE,
        id: 'f1',
        name: fields.name ?? 'thing',
        role: fields.role ?? 'owner',
        type: 'file',
        blobID: 'b1',
        size: fields.size ?? 10,
        mimeType: fields.mimeType,
        trashedAt: null,
    };
}

function folder(id : string) : NodeResponse
{
    return { ...BASE, id, type: 'folder', trashedAt: null };
}

function link(target : LinkTarget | null) : NodeResponse
{
    return { ...BASE, id: 'link1', type: 'link', targetNodeID: 't1', target };
}

//----------------------------------------------------------------------------------------------------------------------

describe('canViewInline', () =>
{
    it('accepts the families the browser renders itself', () =>
    {
        expect(canViewInline('text/plain')).toBe(true);
        expect(canViewInline('text/markdown')).toBe(true);
        expect(canViewInline('image/png')).toBe(true);
        expect(canViewInline('audio/mpeg')).toBe(true);
        expect(canViewInline('video/mp4')).toBe(true);
        expect(canViewInline('application/pdf')).toBe(true);
        expect(canViewInline('application/json')).toBe(true);
    });

    it('rejects types the browser would download instead of render', () =>
    {
        expect(canViewInline('application/octet-stream')).toBe(false);
        expect(canViewInline('application/zip')).toBe(false);
        expect(canViewInline('application/msword')).toBe(false);
        expect(canViewInline('')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('resolveOpen', () =>
{
    it('navigates into a folder', () =>
    {
        expect(resolveOpen(folder('d1'))).toEqual({ kind: 'navigate', folderID: 'd1' });
    });

    it('views a browser-renderable file inline', () =>
    {
        expect(resolveOpen(file('f1', 'image/png'))).toEqual({ kind: 'view', nodeID: 'f1' });
    });

    it('downloads a file the browser cannot render', () =>
    {
        expect(resolveOpen(file('f1', 'application/zip'))).toEqual({ kind: 'download', nodeID: 'f1' });
    });

    // A folder link navigates to the LINK's own id, not the target's, so the URL carries the link and the breadcrumb
    // walks the link's placement rather than the target's (possibly unreachable) ancestry.
    it('navigates a link whose target is a folder to the LINK\'s own id', () =>
    {
        const node = link({ id: 'link1', type: 'folder', name: 'shared' });

        expect(resolveOpen(node)).toEqual({ kind: 'navigate', folderID: 'link1' });
    });

    it('views a link to a renderable file inline via the target', () =>
    {
        const node = link({ id: 't1', type: 'file', name: 'pic.png', mimeType: 'image/png', size: 4 });

        expect(resolveOpen(node)).toEqual({ kind: 'view', nodeID: 't1' });
    });

    it('downloads a link to a non-renderable file via the target', () =>
    {
        const node = link({ id: 't1', type: 'file', name: 'a.zip', mimeType: 'application/zip', size: 4 });

        expect(resolveOpen(node)).toEqual({ kind: 'download', nodeID: 't1' });
    });

    it('downloads a link target that carries no mime type', () =>
    {
        const node = link({ id: 't1', type: 'file', name: 'blob' });

        expect(resolveOpen(node)).toEqual({ kind: 'download', nodeID: 't1' });
    });

    it('opens nothing for a dead link', () =>
    {
        expect(resolveOpen(link(null))).toEqual({ kind: 'none' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The editor intent: small text and markdown route to the in-app editor; everything else keeps its native open. The
// decision is by content and size only -- role never enters it, since a viewer opens the same editor read-only.
//----------------------------------------------------------------------------------------------------------------------

describe('resolveOpen — editor intent', () =>
{
    it('edits a small plain-text file in the app', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'text/plain', name: 'notes.txt' })))
            .toEqual({ kind: 'edit', nodeID: 'f1' });
    });

    it('edits a markdown file by its declared type', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'text/markdown', name: 'readme.md' })))
            .toEqual({ kind: 'edit', nodeID: 'f1' });
    });

    it('edits a markdown file recognized by extension even when its type is wrong', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'application/octet-stream', name: 'notes.md' })))
            .toEqual({ kind: 'edit', nodeID: 'f1' });
    });

    it('edits a file exactly at the size cap', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'text/plain', name: 'big.txt', size: EDITOR_MAX_BYTES })))
            .toEqual({ kind: 'edit', nodeID: 'f1' });
    });

    it('falls back to the native inline preview for a text file over the size cap', () =>
    {
        // Over the floppy-sized ceiling, a text file is no longer hand-editable; text is browser-renderable, so the
        // native handler previews it inline rather than editing or downloading.
        expect(resolveOpen(fileOf({ mimeType: 'text/plain', name: 'huge.txt', size: EDITOR_MAX_BYTES + 1 })))
            .toEqual({ kind: 'view', nodeID: 'f1' });
    });

    it('does not edit a non-text file: an image still previews inline', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'image/png', name: 'pic.png' })))
            .toEqual({ kind: 'view', nodeID: 'f1' });
    });

    it('does not edit a non-text file: a zip still downloads', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'application/zip', name: 'a.zip' })))
            .toEqual({ kind: 'download', nodeID: 'f1' });
    });

    it('routes by content, not role: a viewer still gets the edit intent', () =>
    {
        // The page renders read-only per the caller's role; the OPEN intent is decided by the file alone.
        expect(resolveOpen(fileOf({ mimeType: 'text/plain', name: 'notes.txt', role: 'viewer' })))
            .toEqual({ kind: 'edit', nodeID: 'f1' });
    });

    it('edits through a link to a small text target, using the target id', () =>
    {
        const node = link({ id: 't1', type: 'file', name: 'shared.txt', mimeType: 'text/plain', size: 20 });

        expect(resolveOpen(node)).toEqual({ kind: 'edit', nodeID: 't1' });
    });

    it('falls back to native for a link whose text target is over the cap', () =>
    {
        const node = link({
            id: 't1', type: 'file', name: 'big.txt', mimeType: 'text/plain', size: EDITOR_MAX_BYTES + 1,
        });

        expect(resolveOpen(node)).toEqual({ kind: 'view', nodeID: 't1' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The annotator and player families: a PDF under the annotator's cap annotates, over it the native preview streams it
// lazily instead; audio and video always play in-app, whatever their size, because playback streams.
//----------------------------------------------------------------------------------------------------------------------

describe('resolveOpen — annotator and player intents', () =>
{
    it('annotates a PDF under the annotator cap', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'application/pdf', name: 'form.pdf' })))
            .toEqual({ kind: 'annotate', nodeID: 'f1' });
    });

    it('falls back to the native preview for a PDF over the annotator cap', () =>
    {
        const overCap = fileOf({ mimeType: 'application/pdf', name: 'scan.pdf', size: PDF_ANNOTATOR_MAX_BYTES + 1 });

        expect(resolveOpen(overCap)).toEqual({ kind: 'view', nodeID: 'f1' });
    });

    it('plays a video in the video family', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'video/mp4', name: 'clip.mp4' })))
            .toEqual({ kind: 'play', nodeID: 'f1', media: 'video' });
    });

    it('plays audio in the audio family regardless of size', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'audio/mpeg', name: 'album.mp3', size: 600_000_000 })))
            .toEqual({ kind: 'play', nodeID: 'f1', media: 'audio' });
    });

    it('never lets the media families claim a text file the editor already owns', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'text/plain', name: 'notes.txt' })))
            .toEqual({ kind: 'edit', nodeID: 'f1' });
    });

    it('opens a playlist as a playlist whatever it was typed as — m3u mimes wear an audio/ prefix, and a .m3u '
        + 'often arrives as text/plain the editor would otherwise claim', () =>
    {
        expect(resolveOpen(fileOf({ mimeType: 'audio/x-mpegurl', name: 'mix.weird' })))
            .toEqual({ kind: 'play-playlist', nodeID: 'f1' });
        expect(resolveOpen(fileOf({ mimeType: 'text/plain', name: 'mix.m3u' })))
            .toEqual({ kind: 'play-playlist', nodeID: 'f1' });
        expect(resolveOpen(fileOf({ mimeType: 'application/octet-stream', name: 'mix.M3U8' })))
            .toEqual({ kind: 'play-playlist', nodeID: 'f1' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The default editor mode: markdown by type or extension, plain text otherwise. A per-open toggle overrides it.
//----------------------------------------------------------------------------------------------------------------------

describe('defaultEditorMode', () =>
{
    it('defaults markdown for a markdown mime type', () =>
    {
        expect(defaultEditorMode('text/markdown', 'x')).toBe('markdown');
        expect(defaultEditorMode('text/x-markdown', 'x')).toBe('markdown');
    });

    it('defaults markdown for a .md or .markdown extension whatever the mime', () =>
    {
        expect(defaultEditorMode('text/plain', 'readme.md')).toBe('markdown');
        expect(defaultEditorMode('application/octet-stream', 'notes.markdown')).toBe('markdown');
    });

    it('defaults plain for a .txt file', () =>
    {
        expect(defaultEditorMode('text/plain', 'notes.txt')).toBe('plain');
    });

    it('defaults plain when neither type nor name says markdown', () =>
    {
        expect(defaultEditorMode('', 'file')).toBe('plain');
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Opening a Shared-with-me target: a shared folder navigates into itself; a shared file resolves through the same
// registry as any file. A share never targets a link, so only file and folder cases exist.
//----------------------------------------------------------------------------------------------------------------------

function sharedTarget(fields : Partial<SharedTarget> & Pick<SharedTarget, 'type'>) : SharedTarget
{
    return { id: 's1', name: 'thing', ownerID: 'owner1', ...fields };
}

describe('resolveSharedOpen', () =>
{
    it('navigates into a shared folder by its own id', () =>
    {
        expect(resolveSharedOpen(sharedTarget({ type: 'folder', id: 'dir1' })))
            .toEqual({ kind: 'navigate', folderID: 'dir1' });
    });

    it('opens a small shared text file in the in-app editor', () =>
    {
        const target = sharedTarget({ type: 'file', id: 'f1', name: 'notes.txt', mimeType: 'text/plain', size: 20 });

        expect(resolveSharedOpen(target)).toEqual({ kind: 'edit', nodeID: 'f1' });
    });

    it('annotates a shared PDF in the app like any other reachable PDF', () =>
    {
        const target = sharedTarget({ type: 'file', id: 'f1', name: 'doc.pdf', mimeType: 'application/pdf', size: 20 });

        expect(resolveSharedOpen(target)).toEqual({ kind: 'annotate', nodeID: 'f1' });
    });

    it('downloads a shared file the browser cannot render', () =>
    {
        const target = sharedTarget({ type: 'file', id: 'f1', name: 'a.zip', mimeType: 'application/zip', size: 20 });

        expect(resolveSharedOpen(target)).toEqual({ kind: 'download', nodeID: 'f1' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
