//----------------------------------------------------------------------------------------------------------------------
// Node Type Presentation
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { LinkTarget, NodeResponse } from '@fileshed/core';

import { familyPresentation, isDeadLink, nodePresentation } from '@client/utils/nodeTypePresentation.ts';

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

function file(mimeType : string) : NodeResponse
{
    return { ...BASE, type: 'file', blobID: 'b1', size: 10, mimeType, trashedAt: null };
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
