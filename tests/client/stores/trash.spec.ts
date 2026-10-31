//----------------------------------------------------------------------------------------------------------------------
// Trash Store — emptyAll and filters
//
// emptyAll empties every one of the caller's trashed roots in one call and resets the listing to empty directly,
// without a re-read -- the whole trash just went, so there is nothing left to show. A failed purge propagates and
// leaves the listing as it was, so the caller's toast reports the truth. The Type/Modified filters narrow the listing
// the client already holds, are per-page-visit (a fresh load drops them), and mark a filtered-to-nothing result
// distinctly from a genuinely empty trash.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { NodeListResponse, NodeResponse } from '@fileshed/core';

// Resource Access
import { emptyTrash, listTrash } from '@client/resource-access/nodes.ts';
import { getMe } from '@client/resource-access/me.ts';

// Stores
import { useSessionStore } from '@client/stores/session.ts';
import { useTrashStore } from '@client/stores/trash.ts';

// Support
import { fileNode, folderNode, meFixture } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({
    listTrash: vi.fn(),
    restoreNode: vi.fn(),
    hardDeleteNode: vi.fn(),
    emptyTrash: vi.fn(),
}));

vi.mock('@client/resource-access/me.ts', () => ({ getMe: vi.fn() }));

const listTrashMock = listTrash as unknown as Mock;
const emptyTrashMock = emptyTrash as unknown as Mock;
const getMeMock = getMe as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';
const TRASHED = { trashed: ISO };

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
        listTrashMock.mockResolvedValue(page([
            folderNode({ ...TRASHED, id: 'a' }),
            folderNode({ ...TRASHED, id: 'b' }),
        ]));
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
        listTrashMock.mockResolvedValue(page([ folderNode({ ...TRASHED, id: 'a' }) ]));
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
        getMeMock.mockResolvedValue(refreshedProfile);

        const store = useTrashStore();
        listTrashMock.mockResolvedValue(page([ folderNode({ ...TRASHED, id: 'a' }) ]));
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

    // The trash is in hand once it has been read, so a Type filter narrows the rows already held rather than asking
    // for a narrower read.
    it('narrows the listing in hand by type without asking the server', async () =>
    {
        listTrashMock.mockResolvedValue(page([
            fileNode({ ...TRASHED, id: 'doc', mimeType: 'text/plain' }),
            fileNode({ ...TRASHED, id: 'pic', mimeType: 'image/png' }),
        ]));
        const store = useTrashStore();
        await store.load();
        listTrashMock.mockClear();

        await store.setTypeFamilies([ 'images' ]);

        expect(store.typeFamilies).toEqual([ 'images' ]);
        expect(store.hasActiveFilters).toBe(true);
        expect(store.items.map((node) => node.id)).toEqual([ 'pic' ]);
        expect(listTrashMock).not.toHaveBeenCalled();
    });

    it('narrows the listing in hand by modified date without asking the server', async () =>
    {
        const recent = fileNode({ ...TRASHED, id: 'recent', updated: new Date().toISOString() });
        listTrashMock.mockResolvedValue(page([ fileNode({ ...TRASHED, id: 'ancient' }), recent ]));
        const store = useTrashStore();
        await store.load();
        listTrashMock.mockClear();

        await store.setModified({ kind: 'preset', preset: 'last7' });

        expect(store.items.map((node) => node.id)).toEqual([ 'recent' ]);
        expect(listTrashMock).not.toHaveBeenCalled();
    });

    it('brings back every filtered-out row on clearFilters', async () =>
    {
        listTrashMock.mockResolvedValue(page([
            fileNode({ ...TRASHED, id: 'doc', mimeType: 'text/plain' }),
            fileNode({ ...TRASHED, id: 'pic', mimeType: 'image/png' }),
        ]));
        const store = useTrashStore();
        await store.load();
        await store.setTypeFamilies([ 'images' ]);
        await store.setModified({ kind: 'preset', preset: 'last7' });

        await store.clearFilters();

        expect(store.hasActiveFilters).toBe(false);
        expect(store.items.map((node) => node.id)).toEqual([ 'doc', 'pic' ]);
    });

    // An empty result WITH an active filter is a distinct surface state from a genuinely empty trash.
    it('reports filteredEmpty only when a filter is active and the result is empty', async () =>
    {
        listTrashMock.mockResolvedValue(page([]));
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
        listTrashMock.mockResolvedValue(page([]));
        const store = useTrashStore();
        await store.load();
        await store.setTypeFamilies([ 'images' ]);
        expect(store.typeFamilies).toEqual([ 'images' ]);

        await store.load();

        expect(store.typeFamilies).toEqual([]);
        expect(store.hasActiveFilters).toBe(false);
        expect(listTrashMock.mock.calls.at(-1)?.[0] ?? {}).not.toHaveProperty('types');
    });
});

//----------------------------------------------------------------------------------------------------------------------
