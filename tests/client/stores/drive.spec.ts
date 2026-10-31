//----------------------------------------------------------------------------------------------------------------------
// Drive Store
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

import {
    type ChildrenQuery,
    LISTING_CHUNK_SIZE,
    MAX_COMPLETE_LISTING,
    type NodeListResponse,
    type NodeResponse,
    type UserSummary,
} from '@fileshed/core';

// Resource Access
import { APIError, RegulationAPIError } from '@client/resource-access/apiError.ts';
import {
    copyNode,
    createNode,
    getNode,
    hardDeleteNode,
    listChildren,
    patchNode,
    trashNode,
} from '@client/resource-access/nodes.ts';

// Stores
import { commitFile } from '@client/stores/commitFile.ts';
import { useSessionStore } from '@client/stores/session.ts';

// Support
import { fileNode, folderNode, linkNode, meFixture } from '../support.ts';

// Under test
import { useDriveStore } from '@client/stores/drive.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({
    listChildren: vi.fn(),
    getNode: vi.fn(),
    getNodeSharing: vi.fn(),
    createNode: vi.fn(),
    patchNode: vi.fn(),
    trashNode: vi.fn(),
    copyNode: vi.fn(),
    hardDeleteNode: vi.fn(),
}));

vi.mock('@client/stores/commitFile.ts', () => ({ commitFile: vi.fn() }));

const listChildrenMock = listChildren as unknown as Mock;
const getNodeMock = getNode as unknown as Mock;
const createNodeMock = createNode as unknown as Mock;
const patchNodeMock = patchNode as unknown as Mock;
const trashNodeMock = trashNode as unknown as Mock;
const copyNodeMock = copyNode as unknown as Mock;
const hardDeleteNodeMock = hardDeleteNode as unknown as Mock;
const commitMock = commitFile as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const DOCS_LINK = { id: 'lnk', parentID: 'docs', name: 'Case Test\'s Docs', targetNodeID: 'far' };

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

// A folder of `size` files, answered a chunk at a time the way the listing endpoint does: the rows the query asks for
// and the folder's whole count beside them. Names are zero-padded so the display order is the seeded order.
function servesFolder(size : number) : void
{
    listChildrenMock.mockImplementation((_parentID : string | null, query : Partial<ChildrenQuery>) =>
    {
        const offset = query.offset ?? 0;
        const limit = query.limit ?? LISTING_CHUNK_SIZE;
        const count = Math.max(0, Math.min(limit, size - offset));

        const nodes = Array.from({ length: count }, (_unused, index) =>
        {
            const at = offset + index;
            return fileNode({ id: `f${ at }`, name: `file-${ String(at).padStart(6, '0') }` });
        });

        return Promise.resolve(page(nodes, size));
    });
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

    // A folder in hand is presented by the client, and folders lead however the rest is sorted -- so a listing that
    // arrives file-first is shown folder-first.
    it('populates children and total from the root listing, folders leading', async () =>
    {
        listChildrenMock.mockResolvedValue(page([ fileNode({ id: 'f1' }), folderNode({ id: 'd1' }) ], 2));
        const store = useDriveStore();

        await store.load(null);

        expect(store.children.map((node) => node.id)).toEqual([ 'd1', 'f1' ]);
        expect(store.total).toBe(2);
        expect(store.folderID).toBeNull();
        expect(store.error).toBeNull();
        expect(store.breadcrumb).toEqual([]);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Chunked reading -- a folder arrives a chunk at a time until it is whole, or until the ceiling says to stop.
    //------------------------------------------------------------------------------------------------------------------

    it('reads a folder that fits in one chunk with a single request', async () =>
    {
        servesFolder(400);
        const store = useDriveStore();

        await store.load(null);

        expect(listChildrenMock).toHaveBeenCalledTimes(1);
        expect(listChildrenMock).toHaveBeenCalledWith(
            null,
            expect.objectContaining({ limit: LISTING_CHUNK_SIZE, offset: 0 })
        );
        expect(store.children).toHaveLength(400);
        expect(store.complete).toBe(true);
    });

    it('keeps pulling chunks behind the first until the whole folder is in hand', async () =>
    {
        servesFolder(2500);
        const store = useDriveStore();

        await store.load(null);

        const offsets = listChildrenMock.mock.calls.map((call) => (call[1] as Partial<ChildrenQuery>).offset);
        expect(offsets).toEqual([ 0, 1000, 2000 ]);
        expect(store.children).toHaveLength(2500);
        expect(store.complete).toBe(true);
        expect(store.capped).toBe(false);
    });

    it('stops after the first chunk of a folder past the ceiling and reports itself incomplete', async () =>
    {
        servesFolder(MAX_COMPLETE_LISTING + 1);
        const store = useDriveStore();

        await store.load(null);

        expect(listChildrenMock).toHaveBeenCalledTimes(1);
        expect(store.children).toHaveLength(LISTING_CHUNK_SIZE);
        expect(store.capped).toBe(true);
        expect(store.complete).toBe(false);
    });

    it('pulls the next chunk when the rendering reaches the end of what is loaded', async () =>
    {
        servesFolder(MAX_COMPLETE_LISTING + 1);
        const store = useDriveStore();
        await store.load(null);

        store.reachedIndex(LISTING_CHUNK_SIZE - 1);
        await flushPromises();

        expect(store.children).toHaveLength(2 * LISTING_CHUNK_SIZE);
        expect(listChildrenMock).toHaveBeenLastCalledWith(
            null,
            expect.objectContaining({ offset: LISTING_CHUNK_SIZE })
        );
    });

    it('leaves a capped listing alone while the rendering is nowhere near the end of it', async () =>
    {
        servesFolder(MAX_COMPLETE_LISTING + 1);
        const store = useDriveStore();
        await store.load(null);
        listChildrenMock.mockClear();

        store.reachedIndex(20);
        await flushPromises();

        expect(listChildrenMock).not.toHaveBeenCalled();
        expect(store.children).toHaveLength(LISTING_CHUNK_SIZE);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Breadcrumb
    //------------------------------------------------------------------------------------------------------------------

    it('walks parentID to build the breadcrumb from My Files down to the open folder', async () =>
    {
        listChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'c') { return Promise.resolve(folderNode({ id: 'c', parentID: 'b', name: 'Reports' })); }
            if(id === 'b') { return Promise.resolve(folderNode({ id: 'b', parentID: null, name: 'Work' })); }

            return Promise.reject(new APIError(404, 'not found'));
        });
        const store = useDriveStore();

        await store.load('c');

        expect(store.breadcrumb.map((node) => node.id)).toEqual([ 'b', 'c' ]);
    });

    it('reuses cached ancestors so a listed subfolder builds its crumb without refetching nodes', async () =>
    {
        listChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'b')
            {
                return Promise.resolve(page([ folderNode({ id: 'c', parentID: 'b', name: 'Reports' }) ]));
            }

            return Promise.resolve(page([]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'b') { return Promise.resolve(folderNode({ id: 'b', parentID: null, name: 'Work' })); }

            return Promise.reject(new APIError(404, 'should not be asked'));
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
        listChildrenMock.mockResolvedValue(page([ fileNode({ id: 'f1' }) ]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'x') { return Promise.resolve(folderNode({ id: 'x', parentID: 'p', name: 'Shared' })); }

            return Promise.reject(new APIError(404, 'no access'));
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
        listChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'lnk') { return Promise.resolve(linkNode(DOCS_LINK)); }
            if(id === 'docs') { return Promise.resolve(folderNode({ id: 'docs', parentID: null, name: 'Documents' })); }

            return Promise.reject(new APIError(404, 'out of reach'));
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
        listChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'lnk')
            {
                return Promise.resolve(page([ folderNode({ id: 'sub', parentID: 'far', name: 'Reports' }) ]));
            }

            return Promise.resolve(page([]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'lnk') { return Promise.resolve(linkNode(DOCS_LINK)); }
            if(id === 'docs') { return Promise.resolve(folderNode({ id: 'docs', parentID: null, name: 'Documents' })); }

            return Promise.reject(new APIError(404, 'out of reach'));
        });
        const store = useDriveStore();
        await store.load('lnk');

        await store.load('sub');

        expect(store.breadcrumb.map((node) => node.id)).toEqual([ 'docs', 'lnk', 'sub' ]);
        expect(store.breadcrumb.map((node) => node.name)).toEqual([ 'Documents', 'Case Test\'s Docs', 'Reports' ]);
    });

    it('keeps the seeded logical chain across a same-folder reload from a filter change', async () =>
    {
        listChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'lnk')
            {
                return Promise.resolve(page([ folderNode({ id: 'sub', parentID: 'far', name: 'Reports' }) ]));
            }

            return Promise.resolve(page([]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'lnk') { return Promise.resolve(linkNode(DOCS_LINK)); }
            if(id === 'docs') { return Promise.resolve(folderNode({ id: 'docs', parentID: null, name: 'Documents' })); }

            return Promise.reject(new APIError(404, 'out of reach'));
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
        listChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'sub') { return Promise.resolve(folderNode({ id: 'sub', parentID: 'far', name: 'Reports' })); }

            return Promise.reject(new APIError(404, 'out of reach'));
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
        listChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'c') { return Promise.resolve(folderNode({ id: 'c', parentID: 'b', name: 'Reports' })); }
            if(id === 'b') { return Promise.resolve(folderNode({ id: 'b', parentID: null, name: 'Work' })); }

            return Promise.reject(new APIError(404, 'not found'));
        });
        useSessionStore().me = meFixture();
        const store = useDriveStore();

        await store.load('c');

        expect(store.breadcrumbForeign).toBe(false);
    });

    it('flags the breadcrumb foreign when the physical walk tops out at an unresolvable ancestor', async () =>
    {
        listChildrenMock.mockResolvedValue(page([ fileNode({ id: 'f1' }) ]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'x') { return Promise.resolve(folderNode({ id: 'x', parentID: 'p', name: 'Shared' })); }

            return Promise.reject(new APIError(404, 'no access'));
        });
        useSessionStore().me = meFixture();
        const store = useDriveStore();

        await store.load('x');

        expect(store.breadcrumbForeign).toBe(true);
    });

    it('flags the breadcrumb foreign when the walk reaches a null-parent node owned by someone else', async () =>
    {
        listChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'g')
            {
                return Promise.resolve(folderNode({ id: 'g', parentID: 'r', name: 'Reports', ownerID: 'bob' }));
            }
            if(id === 'r')
            {
                return Promise.resolve(folderNode({ id: 'r', parentID: null, name: 'Shared Root', ownerID: 'bob' }));
            }

            return Promise.reject(new APIError(404, 'not found'));
        });
        useSessionStore().me = meFixture();
        const store = useDriveStore();

        await store.load('g');

        expect(store.breadcrumbForeign).toBe(true);
    });

    it('keeps an own-tree chain anchored across a seeded descent, regardless of the child\'s owner', async () =>
    {
        listChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'lnk')
            {
                return Promise.resolve(page([
                    folderNode({ id: 'sub', parentID: 'far', name: 'Reports', ownerID: 'far-owner' }),
                ]));
            }

            return Promise.resolve(page([]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'lnk') { return Promise.resolve(linkNode(DOCS_LINK)); }
            if(id === 'docs') { return Promise.resolve(folderNode({ id: 'docs', parentID: null, name: 'Documents' })); }

            return Promise.reject(new APIError(404, 'out of reach'));
        });
        useSessionStore().me = meFixture();
        const store = useDriveStore();
        await store.load('lnk');

        await store.load('sub');

        expect(store.breadcrumbForeign).toBe(false);
    });

    it('keeps a foreign chain foreign across a seeded descent', async () =>
    {
        listChildrenMock.mockImplementation((parentID : string | null) =>
        {
            if(parentID === 'g')
            {
                return Promise.resolve(page([ folderNode({ id: 'h', parentID: 'g', name: 'Deeper' }) ]));
            }

            return Promise.resolve(page([ fileNode({ id: 'f1' }) ]));
        });
        getNodeMock.mockImplementation((id : string) =>
        {
            if(id === 'g')
            {
                return Promise.resolve(folderNode({ id: 'g', parentID: 'r', name: 'Reports', ownerID: 'bob' }));
            }

            return Promise.reject(new APIError(404, 'no access'));
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

    // A folder the client holds whole re-orders where it stands: the point of holding it is that sorting costs no
    // request and moves no scrollbar.
    it('re-orders a folder in hand without asking the server', async () =>
    {
        listChildrenMock.mockResolvedValue(page([
            fileNode({ id: 'a' }),
            fileNode({ id: 'b' }),
            fileNode({ id: 'c' }),
        ], 3));
        const store = useDriveStore();
        await store.load(null);
        listChildrenMock.mockClear();

        await store.reSort('name', 'desc');

        expect(store.sortKey).toBe('name');
        expect(store.sortDirection).toBe('desc');
        expect(store.children.map((node) => node.id)).toEqual([ 'c', 'b', 'a' ]);
        expect(listChildrenMock).not.toHaveBeenCalled();
    });

    // Past the ceiling the client has never seen most of the folder, so only the server can order it.
    it('re-reads a folder past the ceiling to sort it', async () =>
    {
        servesFolder(MAX_COMPLETE_LISTING + 1);
        const store = useDriveStore();
        await store.load(null);
        listChildrenMock.mockClear();

        await store.reSort('size', 'desc');

        expect(store.sortKey).toBe('size');
        expect(listChildrenMock).toHaveBeenCalledWith(
            null,
            expect.objectContaining({ sortKey: 'size', sortDirection: 'desc', offset: 0 })
        );
    });

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each action reloads the folder from page zero with the filter folded into the query.
    //------------------------------------------------------------------------------------------------------------------

    it('populates the owner facet from the listing envelope', async () =>
    {
        const owners = [ ownerSummary('u1'), ownerSummary('u2') ];
        listChildrenMock.mockResolvedValue(page([ fileNode({ id: 'f1' }) ], 1, owners));
        const store = useDriveStore();

        await store.load(null);

        expect(store.owners.map((owner) => owner.id)).toEqual([ 'u1', 'u2' ]);
    });

    // knownOwners unions every owner any listing has disclosed and holds onto them: a link crumb keeps needing its
    // target owner's summary after the user descends past the link into a folder whose own facet never names them.
    it('accumulates owner summaries across listings and retains one a later facet drops', async () =>
    {
        listChildrenMock
            .mockResolvedValueOnce(page([ fileNode({ id: 'f1' }) ], 1, [ ownerSummary('bob') ]))
            .mockResolvedValueOnce(page([ fileNode({ id: 'f2' }) ], 1, []));
        getNodeMock.mockRejectedValue(new APIError(404, 'no crumb'));
        const store = useDriveStore();
        await store.load('a');

        await store.load('b');

        expect(store.owners.map((owner) => owner.id)).toEqual([]);
        expect(store.knownOwners.map((owner) => owner.id)).toContain('bob');
    });

    // A folder held whole narrows itself: the rows the filter excludes are still in hand, so clearing it costs
    // nothing either.
    it('narrows a folder in hand by type without asking the server, and widens it back on clear', async () =>
    {
        listChildrenMock.mockResolvedValue(page(
            [ fileNode({ id: 'doc', mimeType: 'text/plain' }), fileNode({ id: 'pic', mimeType: 'image/png' }) ],
            2
        ));
        const store = useDriveStore();
        await store.load(null);
        listChildrenMock.mockClear();

        await store.setTypeFamilies([ 'images' ]);

        expect(store.typeFamilies).toEqual([ 'images' ]);
        expect(store.hasActiveFilters).toBe(true);
        expect(store.children.map((node) => node.id)).toEqual([ 'pic' ]);

        await store.clearFilters();

        expect(store.children.map((node) => node.id)).toEqual([ 'doc', 'pic' ]);
        expect(listChildrenMock).not.toHaveBeenCalled();
    });

    it('narrows a folder in hand by owner without asking the server', async () =>
    {
        const mine = fileNode({ id: 'mine' });
        const theirs = fileNode({ id: 'theirs', ownerID: 'u2' });
        listChildrenMock.mockResolvedValue(page([ mine, theirs ], 2));
        const store = useDriveStore();
        await store.load(null);
        listChildrenMock.mockClear();

        await store.setOwner(ownerSummary('u2'));

        expect(store.owner?.id).toBe('u2');
        expect(store.children.map((node) => node.id)).toEqual([ 'theirs' ]);
        expect(listChildrenMock).not.toHaveBeenCalled();
    });

    it('narrows a folder in hand by modified date without asking the server', async () =>
    {
        const recent = fileNode({ id: 'recent', updated: new Date().toISOString() });
        listChildrenMock.mockResolvedValue(page([ fileNode({ id: 'ancient' }), recent ], 2));
        const store = useDriveStore();
        await store.load(null);
        listChildrenMock.mockClear();

        await store.setModified({ kind: 'preset', preset: 'last7' });

        expect(store.children.map((node) => node.id)).toEqual([ 'recent' ]);
        expect(listChildrenMock).not.toHaveBeenCalled();
    });

    // Past the ceiling the client holds only a slice, so the filter is the server's to apply -- and clearing it has
    // to go back for the rows the narrowed read never returned.
    it('sends the filter to the server for a folder past the ceiling, and reads unfiltered again on clear', async () =>
    {
        servesFolder(MAX_COMPLETE_LISTING + 1);
        const filteredPage = page([ fileNode({ id: 'pic', mimeType: 'image/png' }) ], 1);
        const unfiltered = listChildrenMock.getMockImplementation();
        listChildrenMock.mockImplementation((parentID : string | null, query : Partial<ChildrenQuery>) =>
        {
            return query.types === undefined ? unfiltered?.(parentID, query) : Promise.resolve(filteredPage);
        });
        const store = useDriveStore();
        await store.load(null);

        await store.setTypeFamilies([ 'images' ]);

        expect(listChildrenMock).toHaveBeenLastCalledWith(
            null,
            expect.objectContaining({ types: [ 'images' ], offset: 0 })
        );
        expect(store.children.map((node) => node.id)).toEqual([ 'pic' ]);

        await store.clearFilters();

        expect(store.hasActiveFilters).toBe(false);
        expect(listChildrenMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('types');
        expect(store.capped).toBe(true);
    });

    // An empty result WITH an active filter is a distinct surface state from a truly empty folder.
    it('reports filteredEmpty only when a filter is active and the result is empty', async () =>
    {
        listChildrenMock.mockResolvedValue(page([], 0));
        const store = useDriveStore();
        await store.load(null);

        expect(store.isEmpty).toBe(true);
        expect(store.filteredEmpty).toBe(false);

        await store.setTypeFamilies([ 'images' ]);

        expect(store.filteredEmpty).toBe(true);
    });

    it('resets the filters when navigating to a different folder', async () =>
    {
        listChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockRejectedValue(new APIError(404, 'no crumb'));
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
        listChildrenMock
            .mockResolvedValueOnce(page([ fileNode({ id: 'f1' }) ], 1))
            .mockResolvedValueOnce(page([ fileNode({ id: 'f1' }), folderNode({ id: 'new' }) ], 2));
        createNodeMock.mockResolvedValue(folderNode({ id: 'new' }));
        const store = useDriveStore();
        await store.load(null);

        await store.createFolder('New');

        expect(createNodeMock).toHaveBeenCalledWith({ type: 'folder', name: 'New', parentID: null });
        expect(store.children.map((node) => node.id)).toEqual([ 'new', 'f1' ]);
    });

    it('renames via patch, then refetches', async () =>
    {
        listChildrenMock
            .mockResolvedValueOnce(page([ fileNode({ id: 'f1', name: 'old' }) ]))
            .mockResolvedValueOnce(page([ fileNode({ id: 'f1', name: 'new' }) ]));
        patchNodeMock.mockResolvedValue(fileNode({ id: 'f1', name: 'new' }));
        const store = useDriveStore();
        await store.load(null);

        await store.rename('f1', 'new');

        expect(patchNodeMock).toHaveBeenCalledWith('f1', { name: 'new' });
        expect(store.children[0]?.name).toBe('new');
    });

    it('moves via a parent patch, then refetches', async () =>
    {
        listChildrenMock
            .mockResolvedValueOnce(page([ fileNode({ id: 'f1' }) ]))
            .mockResolvedValueOnce(page([]));
        patchNodeMock.mockResolvedValue(fileNode({ id: 'f1' }));
        const store = useDriveStore();
        await store.load(null);

        await store.move('f1', 'dest');

        expect(patchNodeMock).toHaveBeenCalledWith('f1', { parentID: 'dest' });
        expect(store.children).toEqual([]);
    });

    it('trashes, then refetches', async () =>
    {
        listChildrenMock
            .mockResolvedValueOnce(page([ fileNode({ id: 'f1' }) ]))
            .mockResolvedValueOnce(page([]));
        trashNodeMock.mockResolvedValue(fileNode({ id: 'f1' }));
        const store = useDriveStore();
        await store.load(null);

        await store.trash('f1');

        expect(trashNodeMock).toHaveBeenCalledWith('f1');
        expect(store.children).toEqual([]);
    });

    it('copies a file into the open folder by default, then refetches', async () =>
    {
        listChildrenMock.mockResolvedValue(page([ fileNode({ id: 'f1' }) ]));
        getNodeMock.mockResolvedValue(folderNode({ id: 'here', parentID: null, name: 'Here' }));
        copyNodeMock.mockResolvedValue(fileNode({ id: 'copy' }));
        const store = useDriveStore();
        await store.load('here');

        await store.copy('f1');

        expect(copyNodeMock).toHaveBeenCalledWith('f1', { parentID: 'here' });
    });

    it('creates an empty file in the open folder, then refetches', async () =>
    {
        listChildrenMock.mockResolvedValue(page([]));
        getNodeMock.mockResolvedValue(folderNode({ id: 'here', parentID: null, name: 'Here' }));
        commitMock.mockResolvedValue(fileNode({ id: 'doc' }));
        const store = useDriveStore();
        await store.load('here');
        const listingsBefore = listChildrenMock.mock.calls.length;

        const created = await store.createEmptyFile('notes.md', 'text/markdown');

        const [ file, placement ] = commitMock.mock.calls[0] ?? [];
        expect((file as File).size).toBe(0);
        expect(placement).toEqual({ name: 'notes.md', parentID: 'here', mimeType: 'text/markdown' });
        expect(created.id).toBe('doc');
        expect(listChildrenMock.mock.calls.length).toBeGreaterThan(listingsBefore);
    });

    it('hard-deletes a dead link, then refetches', async () =>
    {
        listChildrenMock
            .mockResolvedValueOnce(page([ fileNode({ id: 'f1' }) ]))
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
        listChildrenMock.mockRejectedValue(new APIError(500, 'boom'));
        const store = useDriveStore();

        await store.load(null);

        expect(store.error).toBeInstanceOf(APIError);
        expect(store.children).toEqual([]);
        expect(store.total).toBe(0);
        expect(store.isEmpty).toBe(false);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Sharing
    //------------------------------------------------------------------------------------------------------------------

    it('keeps each listed node\'s own sharing', async () =>
    {
        const shared = fileNode({ id: 'f1', sharing: { granteeCount: 2, linkURL: '/d/tok' } });
        const theirs = fileNode({ id: 'f2' });
        listChildrenMock.mockResolvedValue(page([ shared, theirs ], 2));
        const store = useDriveStore();

        await store.load(null);

        expect(store.children[0]?.sharing).toEqual({ granteeCount: 2, linkURL: '/d/tok' });
        expect(store.children[1]?.sharing).toBeNull();
    });

    // The share dialog changes a grant or a link on one node; the surface behind it re-reads that node alone rather
    // than the whole folder, and takes the server's answer rather than guessing at the new state.
    it('re-reads one node without disturbing the rest', async () =>
    {
        const first = fileNode({ id: 'f1', sharing: { granteeCount: 1, linkURL: null } });
        const second = fileNode({ id: 'f2', sharing: { granteeCount: 0, linkURL: '/d/other' } });
        listChildrenMock.mockResolvedValue(page([ first, second ], 2));
        getNodeMock.mockResolvedValue(fileNode({ id: 'f1', sharing: { granteeCount: 1, linkURL: '/d/fresh' } }));
        const store = useDriveStore();
        await store.load(null);

        await store.refreshSharingFor('f1');

        expect(getNodeMock).toHaveBeenCalledWith('f1');
        expect(store.children[0]?.sharing).toEqual({ granteeCount: 1, linkURL: '/d/fresh' });
        expect(store.children[1]?.sharing).toEqual({ granteeCount: 0, linkURL: '/d/other' });
    });

    // Revoking the last grant and the last link leaves the owner's own answer that nothing is shared -- zeros, which
    // the badges and the copy-link menu read as nothing to offer. It is not the same as the null a stranger gets.
    it('reports zeros once the last grant and link are revoked', async () =>
    {
        listChildrenMock.mockResolvedValue(page([
            fileNode({ id: 'f1', sharing: { granteeCount: 1, linkURL: '/d/tok' } }),
        ], 1));
        getNodeMock.mockResolvedValue(fileNode({ id: 'f1', sharing: { granteeCount: 0, linkURL: null } }));
        const store = useDriveStore();
        await store.load(null);

        await store.refreshSharingFor('f1');

        expect(store.children[0]?.sharing).toEqual({ granteeCount: 0, linkURL: null });
    });

    it('propagates a regulation rejection from a mutation to the caller', async () =>
    {
        listChildrenMock.mockResolvedValue(page([ fileNode({ id: 'f1' }) ]));
        patchNodeMock.mockRejectedValue(new RegulationAPIError(
            422,
            'blocked',
            [ { code: 'move.intoDescendant', message: 'nope' } ]
        ));
        const store = useDriveStore();
        await store.load(null);

        await expect(store.move('f1', 'dest')).rejects.toBeInstanceOf(RegulationAPIError);
    });
});

//----------------------------------------------------------------------------------------------------------------------
