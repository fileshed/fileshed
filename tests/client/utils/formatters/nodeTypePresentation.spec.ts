//----------------------------------------------------------------------------------------------------------------------
// Node Type Presentation
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { LinkTarget, NodeResponse, SharedTarget } from '@fileshed/core';

import {
    familyPresentation,
    isDeadLink,
    nodeKindLabel,
    nodePresentation,
    sharedTargetPresentation,
} from '@client/utils/formatters/nodeTypePresentation.ts';

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

function file(mimeType : string, name = 'thing') : NodeResponse
{
    return { ...BASE, name, type: 'file', blobID: 'b1', size: 10, mimeType, trashedAt: null };
}

function folder() : NodeResponse
{
    return { ...BASE, type: 'folder', trashedAt: null };
}

function link(target : LinkTarget | null) : NodeResponse
{
    return { ...BASE, type: 'link', targetNodeID: 't1', target };
}

//----------------------------------------------------------------------------------------------------------------------

describe('familyPresentation', () =>
{
    it('gives each family its own icon and colour, PDFs apart from documents', () =>
    {
        expect(familyPresentation('folders')).toMatchObject({ icon: 'i-lucide-folder', color: 'text-amber-500' });
        expect(familyPresentation('documents')).toMatchObject({ icon: 'i-lucide-file-text', color: 'text-blue-500' });
        expect(familyPresentation('pdfs')).toMatchObject({ icon: 'i-lucide-file-type', color: 'text-red-500' });
        expect(familyPresentation('images')).toMatchObject({ icon: 'i-lucide-image', color: 'text-emerald-500' });
    });

    it('labels each family for the filter menu', () =>
    {
        expect(familyPresentation('pdfs').label).toBe('PDFs');
        expect(familyPresentation('video').label).toBe('Video');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('nodePresentation', () =>
{
    it('presents a folder as the folders family', () =>
    {
        expect(nodePresentation(folder())).toMatchObject({ icon: 'i-lucide-folder', color: 'text-amber-500' });
    });

    it('classifies a file by its mime family, PDFs distinct from text documents', () =>
    {
        expect(nodePresentation(file('image/png')).color).toBe('text-emerald-500');
        expect(nodePresentation(file('application/pdf')))
            .toMatchObject({ icon: 'i-lucide-file-type', color: 'text-red-500' });
        expect(nodePresentation(file('text/plain')))
            .toMatchObject({ icon: 'i-lucide-file-text', color: 'text-blue-500' });
    });

    it('gives a file of no known family a neutral, muted glyph', () =>
    {
        expect(nodePresentation(file('application/octet-stream')))
            .toMatchObject({ icon: 'i-lucide-file', color: 'text-muted' });
    });

    it('borrows a link target\'s presentation', () =>
    {
        expect(nodePresentation(link({ id: 't1', type: 'folder', name: 'shared' })))
            .toMatchObject({ icon: 'i-lucide-folder' });
        expect(nodePresentation(link({ id: 't1', type: 'file', name: 'pic.png', mimeType: 'image/png', size: 4 })))
            .toMatchObject({ icon: 'i-lucide-image' });
    });

    it('presents a dead link as the dimmed broken glyph', () =>
    {
        expect(nodePresentation(link(null))).toMatchObject({ icon: 'i-lucide-unlink', color: 'text-dimmed' });
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('isDeadLink', () =>
{
    it('is true only for a link with no resolvable target', () =>
    {
        expect(isDeadLink(link(null))).toBe(true);
        expect(isDeadLink(link({ id: 't1', type: 'folder', name: 'shared' }))).toBe(false);
        expect(isDeadLink(file('text/plain'))).toBe(false);
        expect(isDeadLink(folder())).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('nodeKindLabel', () =>
{
    it('labels a folder, a file by its family, and a resolved link as "Link" rather than its target\'s family', () =>
    {
        expect(nodeKindLabel(folder())).toBe('Folder');
        expect(nodeKindLabel(file('application/pdf'))).toBe('PDF');
        expect(nodeKindLabel(link({ id: 't1', type: 'folder', name: 'shared' }))).toBe('Link');
    });

    it('tells a playlist apart from the audio family it hides in — by mime or by name', () =>
    {
        expect(nodeKindLabel(file('audio/x-mpegurl', 'mix.weird'))).toBe('Playlist');
        expect(nodeKindLabel(file('text/plain', 'mix.m3u'))).toBe('Playlist');
        expect(nodeKindLabel(file('audio/mpeg', 'song.mp3'))).toBe('Audio');

        expect(nodePresentation(file('audio/x-mpegurl', 'mix.m3u8')))
            .toMatchObject({ icon: 'i-lucide-list-music', noun: 'Playlist' });
        expect(nodePresentation(file('audio/mpeg', 'song.mp3')).icon).toBe('i-lucide-music');
    });

    it('labels a dead link by its own broken-glyph noun, not "Link"', () =>
    {
        expect(nodeKindLabel(link(null))).toBe('Broken link');
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('sharedTargetPresentation', () =>
{
    function target(fields : Partial<SharedTarget> & Pick<SharedTarget, 'type'>) : SharedTarget
    {
        return { id: 's1', name: 'thing', ownerID: 'owner1', ...fields };
    }

    it('presents a shared folder as the folders family', () =>
    {
        expect(sharedTargetPresentation(target({ type: 'folder' })))
            .toMatchObject({ icon: 'i-lucide-folder', color: 'text-amber-500' });
    });

    it('presents a shared file by its mime family', () =>
    {
        expect(sharedTargetPresentation(target({ type: 'file', mimeType: 'image/png', size: 4 })))
            .toMatchObject({ icon: 'i-lucide-image', color: 'text-emerald-500' });
    });

    it('gives a shared file of no known family a neutral, muted glyph', () =>
    {
        expect(sharedTargetPresentation(target({ type: 'file', mimeType: 'application/octet-stream', size: 4 })))
            .toMatchObject({ icon: 'i-lucide-file', color: 'text-muted' });
    });
});

//----------------------------------------------------------------------------------------------------------------------
