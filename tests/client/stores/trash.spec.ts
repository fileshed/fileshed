//----------------------------------------------------------------------------------------------------------------------
// Trash Store — emptyAll and filters
//
// emptyAll empties every one of the caller's trashed roots in one call and resets the listing to empty directly,
// without a refetch -- the whole trash just went, so there is nothing left to page. A failed purge propagates and
// leaves the listing as it was, so the caller's toast reports the truth. The Type/Modified filters re-query the trash
// from the first page with the filter folded in, are per-page-visit (a fresh load drops them), and mark a
// filtered-to-nothing result distinctly from a genuinely empty trash.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { emptyTrash, getTrash } from '@client/resource-access/nodes.ts';
import { fetchMe } from '@client/resource-access/me.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';
import { useTrashStore } from '@client/stores/trash.ts';

// Support
import { meFixture } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({
    getTrash: vi.fn(),
    restoreNode: vi.fn(),
    hardDeleteNode: vi.fn(),
    emptyTrash: vi.fn(),
}));

vi.mock('@client/resource-access/me.ts', () => ({ fetchMe: vi.fn() }));

const getTrashMock = getTrash as unknown as Mock;
const emptyTrashMock = emptyTrash as unknown as Mock;
const fetchMeMock = fetchMe as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

function folder(id : string) : NodeResponse
{
    return {
        id,
        name: id,
        type: 'folder',
        ownerID: 'u1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        trashedAt: ISO,
    };
}

function page(nodes : NodeResponse[]) : NodeListResponse
{
    return { nodes, total: nodes.length, limit: 50, offset: 0, owners: [] };
}

//----------------------------------------------------------------------------------------------------------------------

describe('useTrashStore.emptyAll', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        setActivePinia(createPinia());
    });

    it('purges every trashed root and resets the listing to empty', async () =>
    {
        const store = useTrashStore();
        getTrashMock.mockResolvedValue(page([ folder('a'), folder('b') ]));
        await store.load();

        emptyTrashMock.mockResolvedValue({ purged: 2 });
        await store.emptyAll();

        expect(emptyTrashMock).toHaveBeenCalled();
        expect(store.items).toEqual([]);
        expect(store.total).toBe(0);
        expect(store.isEmpty).toBe(true);
    });

    it('leaves the listing untouched when the purge itself fails', async () =>
    {
        const store = useTrashStore();
        getTrashMock.mockResolvedValue(page([ folder('a') ]));
        await store.load();

        emptyTrashMock.mockRejectedValue(new Error('boom'));

        await expect(store.emptyAll()).rejects.toThrow('boom');
        expect(store.items).toHaveLength(1);
        expect(store.total).toBe(1);
    });

    // Trashed bytes still charge the quota; the permanent delete is the moment the gauge moves.
    it('refreshes the session quota after emptying, so the gauge drops', async () =>
    {
        const refreshedProfile = meFixture({ quota: { used: 0, effective: 10_000, limit: 10_000 } });
        fetchMeMock.mockResolvedValue(refreshedProfile);

        const store = useTrashStore();
        getTrashMock.mockResolvedValue(page([ folder('a') ]));
        await store.load();

        emptyTrashMock.mockResolvedValue({ purged: 1 });
        await store.emptyAll();

        expect(useSessionStore().me?.quota).toEqual({ used: 0, effective: 10_000, limit: 10_000 });
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('useTrashStore — filters', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        setActivePinia(createPinia());
    });

    it('re-reads the trash from the first page with the selected type families folded in', async () =>
    {
        getTrashMock.mockResolvedValue(page([]));
        const store = useTrashStore();
        await store.load();

        await store.setTypeFamilies([ 'images', 'pdfs' ]);

        expect(store.typeFamilies).toEqual([ 'images', 'pdfs' ]);
        expect(store.hasActiveFilters).toBe(true);
        expect(getTrashMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ types: [ 'images', 'pdfs' ], offset: 0 })
        );
    });

    it('re-reads with a modified window when a preset is chosen', async () =>
    {
        getTrashMock.mockResolvedValue(page([]));
        const store = useTrashStore();
        await store.load();

        await store.setModified({ kind: 'preset', preset: 'last7' });

        expect(getTrashMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ updatedAfter: expect.any(String) })
        );
    });

    it('drops every filter param on clearFilters', async () =>
    {
        getTrashMock.mockResolvedValue(page([]));
        const store = useTrashStore();
        await store.load();
        await store.setTypeFamilies([ 'images' ]);
        await store.setModified({ kind: 'preset', preset: 'last7' });

        await store.clearFilters();

        expect(store.hasActiveFilters).toBe(false);
        const lastQuery = getTrashMock.mock.calls.at(-1)?.[0] ?? {};
        expect(lastQuery).not.toHaveProperty('types');
        expect(lastQuery).not.toHaveProperty('updatedAfter');
    });

    // An empty result WITH an active filter is a distinct surface state from a genuinely empty trash.
    it('reports filteredEmpty only when a filter is active and the result is empty', async () =>
    {
        getTrashMock.mockResolvedValue(page([]));
        const store = useTrashStore();
        await store.load();

        expect(store.isEmpty).toBe(true);
        expect(store.filteredEmpty).toBe(false);

        await store.setTypeFamilies([ 'images' ]);

        expect(store.filteredEmpty).toBe(true);
    });

    // Filters are per-page-visit: revisiting the trash (a fresh load) starts unfiltered.
    it('resets the filters on a fresh load', async () =>
    {
        getTrashMock.mockResolvedValue(page([]));
        const store = useTrashStore();
        await store.load();
        await store.setTypeFamilies([ 'images' ]);
        expect(store.typeFamilies).toEqual([ 'images' ]);

        await store.load();

        expect(store.typeFamilies).toEqual([]);
        expect(store.hasActiveFilters).toBe(false);
        expect(getTrashMock.mock.calls.at(-1)?.[0] ?? {}).not.toHaveProperty('types');
    });
});

//----------------------------------------------------------------------------------------------------------------------
