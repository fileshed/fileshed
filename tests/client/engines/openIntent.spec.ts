//----------------------------------------------------------------------------------------------------------------------
// Native Viewer
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { LinkTarget, NodeResponse } from '@fileshed/core';

import { canViewInline, resolveOpen } from '@client/engines/openIntent.ts';

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

    it('navigates a link whose target is a folder, using the target id', () =>
    {
        const node = link({ id: 't1', type: 'folder', name: 'shared' });

        expect(resolveOpen(node)).toEqual({ kind: 'navigate', folderID: 't1' });
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
