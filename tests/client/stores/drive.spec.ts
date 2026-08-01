//----------------------------------------------------------------------------------------------------------------------
// Drive Store
//----------------------------------------------------------------------------------------------------------------------

import { createHmac } from 'node:crypto';

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { MeResponse, NodeListResponse, NodeResponse, UserSummary } from '@fileshed/core';

// Resource Access
import { ApiError, RegulationApiError } from '@client/resource-access/apiError.ts';
import {
    copyNode,
    createNode,
    getChildren,
    getNode,
    hardDeleteNode,
    patchNode,
    trashNode,
} from '@client/resource-access/nodes.ts';
import { answerChallenge, claimBlob, uploadTicket } from '@client/resource-access/blobs.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';

// Under test
import { useDriveStore } from '@client/stores/drive.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({
    getChildren: vi.fn(),
    getNode: vi.fn(),
    createNode: vi.fn(),
    patchNode: vi.fn(),
    trashNode: vi.fn(),
    copyNode: vi.fn(),
    hardDeleteNode: vi.fn(),
}));

vi.mock('@client/resource-access/blobs.ts', () => ({
    claimBlob: vi.fn(),
    uploadTicket: vi.fn(),
    answerChallenge: vi.fn(),
}));

const getChildrenMock = getChildren as unknown as Mock;
const getNodeMock = getNode as unknown as Mock;
const createNodeMock = createNode as unknown as Mock;
const patchNodeMock = patchNode as unknown as Mock;
const trashNodeMock = trashNode as unknown as Mock;
const copyNodeMock = copyNode as unknown as Mock;
const hardDeleteNodeMock = hardDeleteNode as unknown as Mock;
const claimBlobMock = claimBlob as unknown as Mock;
const uploadTicketMock = uploadTicket as unknown as Mock;
const answerChallengeMock = answerChallenge as unknown as Mock;

// The SHA-256 of zero bytes -- the digest every empty file claims.
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function folderNode(id : string, parentID : string | null = null, name : string = id) : NodeResponse
{
    return {
        id,
        name,
        ownerID: 'u1',
        parentID,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'folder',
        trashedAt: null,
    };
}

function fileNode(id : string, name : string = id) : NodeResponse
{
    return {
        id,
        name,
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'file',
        blobID: 'b1',
        size: 100,
        mimeType: 'text/plain',
        trashedAt: null,
    };
}

function linkNode(id : string, parentID : string | null, name : string, targetNodeID : string) : NodeResponse
{
    return {
        id,
        name,
        ownerID: 'u1',
        parentID,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'link',
        targetNodeID,
        target: null,
    };
}

function page(
    nodes : NodeResponse[],
    total : number = nodes.length,
    owners : UserSummary[] = []
) : NodeListResponse
{
    return { nodes, total, limit: 50, offset: 0, owners };
}

function ownerSummary(id : string) : UserSummary
{
    return { id, name: id, email: `${ id }@example.com`, image: null };
}

// The signed-in caller's profile, whose id anchors the breadcrumb -- folderNode's ownerID defaults to 'u1', matching
// this fixture's default id, so an ordinary chain reads own-tree unless a test overrides a node's owner.
function meFixture(overrides : Partial<MeResponse> = {}) : MeResponse
{
    return {
        id: 'u1',
        email: 'u1@example.com',
        role: 'user',
        quota: { used: 0, effective: null, limit: null },
        limits: { trashRetentionDays: 30 },
        preferences: {},
        createdAt: ISO,
        ...overrides,
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('useDriveStore', () =>
{
    beforeEach(() =>
    {
        setActivePinia(createPinia());
        vi.clearAllMocks();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Listing
    //------------------------------------------------------------------------------------------------------------------

    it('populates children and total from the root listing', async () =>
    {
        getChildrenMock.mockResolvedValue(page([ fileNode('f1'), folderNode('d1') ], 2));
        const store = useDriveStore();

        await store.load(null);

        expect(store.children.map((node) => node.id)).toEqual([ 'f1', 'd1' ]);
        expect(store.total).toBe(2);
        expect(store.folderID).toBeNull();
        expect(store.error).toBeNull();
        expect(store.breadcrumb).toEqual([]);
    });

    it('reports more to load while fewer children than the total are held', async () =>
    {
        getChildrenMock.mockResolvedValue(page([ fileNode('f1'), fileNode('f2') ], 8));
        const store = useDriveStore();

        await store.load(null);

        expect(store.hasMore).toBe(true);
    });

    it('accumulates the next page onto the current children on loadMore', async () =>
    {
        getChildrenMock
            .mockResolvedValueOnce(page([ fileNode('f1'), fileNode('f2') ], 3))
            .mockResolvedValueOnce(page([ fileNode('f3') ], 3));
        const store = useDriveStore();
        await store.load(null);

        await store.loadMore();

        expect(store.children.map((node) => node.id)).toEqual([ 'f1', 'f2', 'f3' ]);
        expect(store.hasMore).toBe(false);
        expect(getChildrenMock).toHaveBeenLastCalledWith(null, expect.objectContaining({ offset: 2 }));
    });

    //------------------------------------------------------------------------------------------------------------------
    // Breadcrumb
    //------------------------------------------------------------------------------------------------------------------

    it('walks parentID to build the breadcrumb from My Files down to the open folder', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'c') { return Promise.resolve(folderNode('c', 'b', 'Reports')); }
            if(id === 'b') { return Promise.resolve(folderNode('b', null, 'Work')); }

            return Promise.reject(new ApiError(404, 'not found'));
        });
        const store = useDriveStore();

        await store.load('c');

        expect(store.breadcrumb.map((node) => node.id)).toEqual([ 'b', 'c' ]);
    });

    it('reuses cached ancestors so a listed subfolder builds its crumb without refetching nodes', async () =>
    {
        getChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'b') { return Promise.resolve(page([ folderNode('c', 'b', 'Reports') ])); }

            return Promise.resolve(page([]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'b') { return Promise.resolve(folderNode('b', null, 'Work')); }

            return Promise.reject(new ApiError(404, 'should not be asked'));
        });
        const store = useDriveStore();
        await store.load('b');

        await store.load('c');

        expect(store.breadcrumb.map((node) => node.id)).toEqual([ 'b', 'c' ]);
        expect(getNodeMock).toHaveBeenCalledTimes(1);
        expect(getNodeMock).toHaveBeenCalledWith('b');
    });

    it('tops out the breadcrumb at an unresolvable ancestor instead of failing the load', async () =>
    {
        getChildrenMock.mockResolvedValue(page([ fileNode('f1') ]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'x') { return Promise.resolve(folderNode('x', 'p', 'Shared')); }

            return Promise.reject(new ApiError(404, 'no access'));
        });
        const store = useDriveStore();

        await store.load('x');

        expect(store.error).toBeNull();
        expect(store.children.map((node) => node.id)).toEqual([ 'f1' ]);
        expect(store.breadcrumb.map((node) => node.id)).toEqual([ 'x' ]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Breadcrumb through a folder link -- the URL carries the LINK's id, so the crumb chain must show the link's own
    // placement (My Files > ... > link name), and a descent into the target's physical children keeps that logical
    // prefix in front of the child rather than collapsing to the child's real ancestry.
    //------------------------------------------------------------------------------------------------------------------

    it('walks the link\'s own parent chain, ending on the link\'s name, when the open id is a folder link', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'lnk') { return Promise.resolve(linkNode('lnk', 'docs', 'Case Test\'s Docs', 'far')); }
            if(id === 'docs') { return Promise.resolve(folderNode('docs', null, 'Documents')); }

            return Promise.reject(new ApiError(404, 'out of reach'));
        });
        const store = useDriveStore();

        await store.load('lnk');

        expect(store.breadcrumb.map((node) => node.id)).toEqual([ 'docs', 'lnk' ]);
        expect(store.breadcrumb.map((node) => node.name)).toEqual([ 'Documents', 'Case Test\'s Docs' ]);
        expect(store.breadcrumb.at(-1)?.type).toBe('link');
    });

    it('seeds a descended child\'s crumb as the link chain plus the child', async () =>
    {
        // The link lists its target's physical children; 'sub' physically lives under 'far' (the target), whose
        // ancestry the caller cannot reach -- so a physical walk from 'sub' would clip to just 'sub'. The descent must
        // instead carry the on-screen chain forward.
        getChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'lnk') { return Promise.resolve(page([ folderNode('sub', 'far', 'Reports') ])); }

            return Promise.resolve(page([]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'lnk') { return Promise.resolve(linkNode('lnk', 'docs', 'Case Test\'s Docs', 'far')); }
            if(id === 'docs') { return Promise.resolve(folderNode('docs', null, 'Documents')); }

            return Promise.reject(new ApiError(404, 'out of reach'));
        });
        const store = useDriveStore();
        await store.load('lnk');

        await store.load('sub');

        expect(store.breadcrumb.map((node) => node.id)).toEqual([ 'docs', 'lnk', 'sub' ]);
        expect(store.breadcrumb.map((node) => node.name)).toEqual([ 'Documents', 'Case Test\'s Docs', 'Reports' ]);
    });

    it('keeps the seeded logical chain across a same-folder reload from a filter change', async () =>
    {
        getChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'lnk') { return Promise.resolve(page([ folderNode('sub', 'far', 'Reports') ])); }

            return Promise.resolve(page([]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'lnk') { return Promise.resolve(linkNode('lnk', 'docs', 'Case Test\'s Docs', 'far')); }
            if(id === 'docs') { return Promise.resolve(folderNode('docs', null, 'Documents')); }

            return Promise.reject(new ApiError(404, 'out of reach'));
        });
        const store = useDriveStore();
        await store.load('lnk');
        await store.load('sub');

        await store.setTypeFamilies([ 'folders' ]);

        expect(store.breadcrumb.map((node) => node.id)).toEqual([ 'docs', 'lnk', 'sub' ]);
    });

    // A cold deep-link straight to a physical child under a link target has no on-screen chain to carry, so it falls
    // back to the physical parent walk and clips at the first unreachable ancestor -- the accepted limitation.
    it('falls back to the clipped physical walk on a cold load of a deep physical child', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'sub') { return Promise.resolve(folderNode('sub', 'far', 'Reports')); }

            return Promise.reject(new ApiError(404, 'out of reach'));
        });
        const store = useDriveStore();

        await store.load('sub');

        expect(store.breadcrumb.map((node) => node.id)).toEqual([ 'sub' ]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Breadcrumb anchor -- whether the chain roots in the caller's own tree or a foreign one reached only by grant.
    // The page steers a foreign chain's crumb root to Shared with me instead of My Files.
    //------------------------------------------------------------------------------------------------------------------

    it('anchors the breadcrumb own-tree when the physical walk reaches a null-parent node the caller owns', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'c') { return Promise.resolve(folderNode('c', 'b', 'Reports')); }
            if(id === 'b') { return Promise.resolve(folderNode('b', null, 'Work')); }

            return Promise.reject(new ApiError(404, 'not found'));
        });
        useSessionStore().me = meFixture();
        const store = useDriveStore();

        await store.load('c');

        expect(store.breadcrumbForeign).toBe(false);
    });

    it('flags the breadcrumb foreign when the physical walk tops out at an unresolvable ancestor', async () =>
    {
        getChildrenMock.mockResolvedValue(page([ fileNode('f1') ]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'x') { return Promise.resolve(folderNode('x', 'p', 'Shared')); }

            return Promise.reject(new ApiError(404, 'no access'));
        });
        useSessionStore().me = meFixture();
        const store = useDriveStore();

        await store.load('x');

        expect(store.breadcrumbForeign).toBe(true);
    });

    it('flags the breadcrumb foreign when the walk reaches a null-parent node owned by someone else', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'g') { return Promise.resolve({ ...folderNode('g', 'r', 'Reports'), ownerID: 'bob' }); }
            if(id === 'r') { return Promise.resolve({ ...folderNode('r', null, 'Shared Root'), ownerID: 'bob' }); }

            return Promise.reject(new ApiError(404, 'not found'));
        });
        useSessionStore().me = meFixture();
        const store = useDriveStore();

        await store.load('g');

        expect(store.breadcrumbForeign).toBe(true);
    });

    it('keeps an own-tree chain anchored across a seeded descent, regardless of the child\'s owner', async () =>
    {
        getChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'lnk')
            {
                return Promise.resolve(page([ { ...folderNode('sub', 'far', 'Reports'), ownerID: 'far-owner' } ]));
            }

            return Promise.resolve(page([]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'lnk') { return Promise.resolve(linkNode('lnk', 'docs', 'Case Test\'s Docs', 'far')); }
            if(id === 'docs') { return Promise.resolve(folderNode('docs', null, 'Documents')); }

            return Promise.reject(new ApiError(404, 'out of reach'));
        });
        useSessionStore().me = meFixture();
        const store = useDriveStore();
        await store.load('lnk');

        await store.load('sub');

        expect(store.breadcrumbForeign).toBe(false);
    });

    it('keeps a foreign chain foreign across a seeded descent', async () =>
    {
        getChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'g') { return Promise.resolve(page([ folderNode('h', 'g', 'Deeper') ])); }

            return Promise.resolve(page([ fileNode('f1') ]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'g') { return Promise.resolve({ ...folderNode('g', 'r', 'Reports'), ownerID: 'bob' }); }

            return Promise.reject(new ApiError(404, 'no access'));
        });
        useSessionStore().me = meFixture();
        const store = useDriveStore();
        await store.load('g');
        expect(store.breadcrumbForeign).toBe(true);

        await store.load('h');

        expect(store.breadcrumbForeign).toBe(true);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Sort
    //------------------------------------------------------------------------------------------------------------------

    it('reloads the folder with the new key and direction on reSort', async () =>
    {
        getChildrenMock
            .mockResolvedValueOnce(page([ fileNode('a'), fileNode('b') ]))
            .mockResolvedValueOnce(page([ fileNode('b'), fileNode('a') ]));
        const store = useDriveStore();
        await store.load(null);

        await store.reSort('size', 'desc');

        expect(store.sortKey).toBe('size');
        expect(store.sortDirection).toBe('desc');
        expect(store.children.map((node) => node.id)).toEqual([ 'b', 'a' ]);
        expect(getChildrenMock).toHaveBeenLastCalledWith(
            null,
            expect.objectContaining({ sortKey: 'size', sortDirection: 'desc' })
        );
    });

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each action reloads the folder from page zero with the filter folded into the query.
    //------------------------------------------------------------------------------------------------------------------

    it('populates the owner facet from the listing envelope', async () =>
    {
        const owners = [ ownerSummary('u1'), ownerSummary('u2') ];
        getChildrenMock.mockResolvedValue(page([ fileNode('f1') ], 1, owners));
        const store = useDriveStore();

        await store.load(null);

        expect(store.owners.map((owner) => owner.id)).toEqual([ 'u1', 'u2' ]);
    });

    // knownOwners unions every owner any listing has disclosed and holds onto them: a link crumb keeps needing its
    // target owner's summary after the user descends past the link into a folder whose own facet never names them.
    it('accumulates owner summaries across listings and retains one a later facet drops', async () =>
    {
        getChildrenMock
            .mockResolvedValueOnce(page([ fileNode('f1') ], 1, [ ownerSummary('bob') ]))
            .mockResolvedValueOnce(page([ fileNode('f2') ], 1, []));
        getNodeMock.mockRejectedValue(new ApiError(404, 'no crumb'));
        const store = useDriveStore();
        await store.load('a');

        await store.load('b');

        expect(store.owners.map((owner) => owner.id)).toEqual([]);
        expect(store.knownOwners.map((owner) => owner.id)).toContain('bob');
    });

    it('reloads with the selected type families and marks filters active', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        const store = useDriveStore();
        await store.load(null);

        await store.setTypeFamilies([ 'images', 'pdfs' ]);

        expect(store.typeFamilies).toEqual([ 'images', 'pdfs' ]);
        expect(store.hasActiveFilters).toBe(true);
        expect(getChildrenMock).toHaveBeenLastCalledWith(
            null,
            expect.objectContaining({ types: [ 'images', 'pdfs' ], offset: 0 })
        );
    });

    it('reloads with the selected owner id', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        const store = useDriveStore();
        await store.load(null);

        await store.setOwner(ownerSummary('u2'));

        expect(store.owner?.id).toBe('u2');
        expect(getChildrenMock).toHaveBeenLastCalledWith(null, expect.objectContaining({ ownerID: 'u2' }));
    });

    it('reloads with a modified window when a preset is chosen', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        const store = useDriveStore();
        await store.load(null);

        await store.setModified({ kind: 'preset', preset: 'last7' });

        expect(getChildrenMock).toHaveBeenLastCalledWith(
            null,
            expect.objectContaining({ updatedAfter: expect.any(String) })
        );
    });

    it('drops every filter param on clearFilters', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        const store = useDriveStore();
        await store.load(null);
        await store.setTypeFamilies([ 'images' ]);
        await store.setOwner(ownerSummary('u2'));

        await store.clearFilters();

        expect(store.hasActiveFilters).toBe(false);
        const lastQuery = getChildrenMock.mock.calls.at(-1)?.[1] ?? {};
        expect(lastQuery).not.toHaveProperty('types');
        expect(lastQuery).not.toHaveProperty('ownerID');
        expect(lastQuery).not.toHaveProperty('updatedAfter');
    });

    // An empty result WITH an active filter is a distinct surface state from a truly empty folder.
    it('reports filteredEmpty only when a filter is active and the result is empty', async () =>
    {
        getChildrenMock.mockResolvedValue(page([], 0));
        const store = useDriveStore();
        await store.load(null);

        expect(store.isEmpty).toBe(true);
        expect(store.filteredEmpty).toBe(false);

        await store.setTypeFamilies([ 'images' ]);

        expect(store.filteredEmpty).toBe(true);
    });

    it('resets the filters when navigating to a different folder', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockRejectedValue(new ApiError(404, 'no crumb'));
        const store = useDriveStore();
        await store.load('a');
        await store.setTypeFamilies([ 'images' ]);
        expect(store.typeFamilies).toEqual([ 'images' ]);

        await store.load('b');

        expect(store.typeFamilies).toEqual([]);
        expect(store.hasActiveFilters).toBe(false);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Mutations -- each calls the RA, then the refetch is observable in the children.
    //------------------------------------------------------------------------------------------------------------------

    it('creates a folder under the open folder, then refetches', async () =>
    {
        getChildrenMock
            .mockResolvedValueOnce(page([ fileNode('f1') ], 1))
            .mockResolvedValueOnce(page([ fileNode('f1'), folderNode('new') ], 2));
        createNodeMock.mockResolvedValue(folderNode('new'));
        const store = useDriveStore();
        await store.load(null);

        await store.createFolder('New');

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'folder', name: 'New', parentID: null });
        expect(store.children.map((node) => node.id)).toEqual([ 'f1', 'new' ]);
    });

    it('renames via patch, then refetches', async () =>
    {
        getChildrenMock
            .mockResolvedValueOnce(page([ fileNode('f1', 'old') ]))
            .mockResolvedValueOnce(page([ fileNode('f1', 'new') ]));
        patchNodeMock.mockResolvedValue(fileNode('f1', 'new'));
        const store = useDriveStore();
        await store.load(null);

        await store.rename('f1', 'new');

        expect(patchNodeMock).toHaveBeenCalledWith('f1', { name: 'new' });
        expect(store.children[0]?.name).toBe('new');
    });

    it('moves via a parent patch, then refetches', async () =>
    {
        getChildrenMock
            .mockResolvedValueOnce(page([ fileNode('f1') ]))
            .mockResolvedValueOnce(page([]));
        patchNodeMock.mockResolvedValue(fileNode('f1'));
        const store = useDriveStore();
        await store.load(null);

        await store.move('f1', 'dest');

        expect(patchNodeMock).toHaveBeenCalledWith('f1', { parentID: 'dest' });
        expect(store.children).toEqual([]);
    });

    it('trashes, then refetches', async () =>
    {
        getChildrenMock
            .mockResolvedValueOnce(page([ fileNode('f1') ]))
            .mockResolvedValueOnce(page([]));
        trashNodeMock.mockResolvedValue(fileNode('f1'));
        const store = useDriveStore();
        await store.load(null);

        await store.trash('f1');

        expect(trashNodeMock).toHaveBeenCalledWith('f1');
        expect(store.children).toEqual([]);
    });

    it('copies a file into the open folder by default, then refetches', async () =>
    {
        getChildrenMock.mockResolvedValue(page([ fileNode('f1') ]));
        getNodeMock.mockResolvedValue(folderNode('here', null, 'Here'));
        copyNodeMock.mockResolvedValue(fileNode('copy'));
        const store = useDriveStore();
        await store.load('here');

        await store.copy('f1');

        expect(copyNodeMock).toHaveBeenCalledWith('f1', { parentID: 'here' });
    });

    it('creates an empty file by uploading zero bytes against the claim ticket, then refetches', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockResolvedValue(folderNode('here', null, 'Here'));
        claimBlobMock.mockResolvedValue({ upload: true, ticket: 'TICKET' });
        uploadTicketMock.mockResolvedValue(fileNode('doc'));
        const store = useDriveStore();
        await store.load('here');

        await store.createEmptyFile('notes.md', 'text/markdown');

        expect(claimBlobMock).toHaveBeenCalledWith({ sha256: EMPTY_SHA256, size: 0 });
        const [ ticket, body, metadata ] = uploadTicketMock.mock.calls[0] ?? [];
        expect(ticket).toBe('TICKET');
        expect(body).toBeInstanceOf(Uint8Array);
        expect((body as Uint8Array).byteLength).toBe(0);
        expect(metadata).toEqual({ name: 'notes.md', parentID: 'here', mimeType: 'text/markdown' });
        expect(answerChallengeMock).not.toHaveBeenCalled();
    });

    it('answers a claim challenge with the empty-content proof when the blob is already known', async () =>
    {
        getChildrenMock.mockResolvedValue(page([]));
        claimBlobMock.mockResolvedValue({ upload: false, challengeID: 'CH', nonce: 'a1b2c3d4', ranges: [] });
        answerChallengeMock.mockResolvedValue(fileNode('doc'));
        const store = useDriveStore();
        await store.load(null);

        await store.createEmptyFile('Untitled.txt', 'text/plain');

        const expectedAnswer = createHmac('sha256', 'a1b2c3d4').digest('hex');
        expect(answerChallengeMock).toHaveBeenCalledWith('CH', {
            answer: expectedAnswer,
            name: 'Untitled.txt',
            parentID: null,
            mimeType: 'text/plain',
        });
        expect(uploadTicketMock).not.toHaveBeenCalled();
    });

    it('hard-deletes a dead link, then refetches', async () =>
    {
        getChildrenMock
            .mockResolvedValueOnce(page([ fileNode('f1') ]))
            .mockResolvedValueOnce(page([]));
        hardDeleteNodeMock.mockResolvedValue(undefined);
        const store = useDriveStore();
        await store.load(null);

        await store.removeDeadLink('link1');

        expect(hardDeleteNodeMock).toHaveBeenCalledWith('link1');
        expect(store.children).toEqual([]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Errors
    //------------------------------------------------------------------------------------------------------------------

    it('lands a failed listing in error with an empty, non-empty-state surface', async () =>
    {
        getChildrenMock.mockRejectedValue(new ApiError(500, 'boom'));
        const store = useDriveStore();

        await store.load(null);

        expect(store.error).toBeInstanceOf(ApiError);
        expect(store.children).toEqual([]);
        expect(store.total).toBe(0);
        expect(store.isEmpty).toBe(false);
    });

    it('propagates a regulation rejection from a mutation to the caller', async () =>
    {
        getChildrenMock.mockResolvedValue(page([ fileNode('f1') ]));
        patchNodeMock.mockRejectedValue(new RegulationApiError(
            422,
            'blocked',
            [ { code: 'move.intoDescendant', message: 'nope' } ]
        ));
        const store = useDriveStore();
        await store.load(null);

        await expect(store.move('f1', 'dest')).rejects.toBeInstanceOf(RegulationApiError);
    });
});

//----------------------------------------------------------------------------------------------------------------------
