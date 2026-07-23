//----------------------------------------------------------------------------------------------------------------------
// Shared Store — listing and filters
//
// The caller's shared-with-me listing is a single unpaginated read. The Type/Modified filters re-query it with the
// filter folded into the query, are per-page-visit (a fresh load drops them, a mutation's refetch keeps them), and mark
// a filtered-to-nothing result distinctly from nothing being shared at all. Only the resource-access boundary is
// mocked; the store's own orchestration is exercised for real.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { SharedTarget, SharedWithMeEntry } from '@fileshed/core';

// Resource Access
import { leaveShare, sharedWithMe } from '@client/resource-access/shares.ts';

// Under test
import { useSharedStore } from '@client/stores/shared.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ copyNode: vi.fn(), createNode: vi.fn() }));
vi.mock('@client/resource-access/shares.ts', () => ({ sharedWithMe: vi.fn(), leaveShare: vi.fn() }));

const sharedWithMeMock = sharedWithMe as unknown as Mock;
const leaveShareMock = leaveShare as unknown as Mock;

//----------------------------------------------------------------------------------------------------------------------

const OWNER = { id: 'owner1', name: 'Ada Lovelace', email: 'ada@example.com', image: null };

function fileTarget(id : string) : SharedTarget
{
    return { id, type: 'file', name: id, ownerID: 'owner1', mimeType: 'text/plain', size: 20 };
}

function entry(target : SharedTarget) : SharedWithMeEntry
{
    return {
        share: {
            id: `s-${ target.id }`,
            nodeID: target.id,
            granteeUserID: 'me',
            role: 'viewer',
            createdBy: 'owner1',
            createdAt: '2026-07-01T00:00:00.000Z',
        },
        target,
        owner: OWNER,
        placed: false,
    };
}

function listing(entries : SharedWithMeEntry[]) : { entries : SharedWithMeEntry[] }
{
    return { entries };
}

//----------------------------------------------------------------------------------------------------------------------

describe('useSharedStore', () =>
{
    beforeEach(() =>
    {
        vi.clearAllMocks();
        setActivePinia(createPinia());
        leaveShareMock.mockResolvedValue(undefined);
    });

    it('populates the entries from the listing', async () =>
    {
        sharedWithMeMock.mockResolvedValue(listing([ entry(fileTarget('a')), entry(fileTarget('b')) ]));
        const store = useSharedStore();

        await store.load();

        expect(store.entries.map((item) => item.target.id)).toEqual([ 'a', 'b' ]);
        expect(store.error).toBeNull();
    });

    it('re-queries with the selected type families folded in and marks filters active', async () =>
    {
        sharedWithMeMock.mockResolvedValue(listing([]));
        const store = useSharedStore();
        await store.load();

        await store.setTypeFamilies([ 'images', 'pdfs' ]);

        expect(store.typeFamilies).toEqual([ 'images', 'pdfs' ]);
        expect(store.hasActiveFilters).toBe(true);
        expect(sharedWithMeMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ types: [ 'images', 'pdfs' ] })
        );
    });

    it('re-queries with a modified window when a preset is chosen', async () =>
    {
        sharedWithMeMock.mockResolvedValue(listing([]));
        const store = useSharedStore();
        await store.load();

        await store.setModified({ kind: 'preset', preset: 'last7' });

        expect(sharedWithMeMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ updatedAfter: expect.any(String) })
        );
    });

    it('drops every filter param on clearFilters', async () =>
    {
        sharedWithMeMock.mockResolvedValue(listing([]));
        const store = useSharedStore();
        await store.load();
        await store.setTypeFamilies([ 'images' ]);
        await store.setModified({ kind: 'preset', preset: 'last7' });

        await store.clearFilters();

        expect(store.hasActiveFilters).toBe(false);
        const lastQuery = sharedWithMeMock.mock.calls.at(-1)?.[0] ?? {};
        expect(lastQuery).not.toHaveProperty('types');
        expect(lastQuery).not.toHaveProperty('updatedAfter');
    });

    // An empty listing WITH an active filter is a distinct surface state from nothing being shared at all.
    it('reports filteredEmpty only when a filter is active and the listing is empty', async () =>
    {
        sharedWithMeMock.mockResolvedValue(listing([]));
        const store = useSharedStore();
        await store.load();

        expect(store.isEmpty).toBe(true);
        expect(store.filteredEmpty).toBe(false);

        await store.setTypeFamilies([ 'images' ]);

        expect(store.filteredEmpty).toBe(true);
    });

    // Filters are per-page-visit: revisiting the page (a fresh load) starts unfiltered.
    it('resets the filters on a fresh load', async () =>
    {
        sharedWithMeMock.mockResolvedValue(listing([]));
        const store = useSharedStore();
        await store.load();
        await store.setTypeFamilies([ 'images' ]);
        expect(store.typeFamilies).toEqual([ 'images' ]);

        await store.load();

        expect(store.typeFamilies).toEqual([]);
        expect(store.hasActiveFilters).toBe(false);
        expect(sharedWithMeMock.mock.calls.at(-1)?.[0] ?? {}).not.toHaveProperty('types');
    });
});

//----------------------------------------------------------------------------------------------------------------------
