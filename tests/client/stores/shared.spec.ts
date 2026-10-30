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
import { leaveShare, listSharedWithMe } from '@client/resource-access/shares.ts';

// Under test
import { useSharedStore } from '@client/stores/shared.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/nodes.ts', () => ({ copyNode: vi.fn(), createNode: vi.fn() }));
vi.mock('@client/resource-access/shares.ts', () => ({ listSharedWithMe: vi.fn(), leaveShare: vi.fn() }));

const listSharedWithMeMock = listSharedWithMe as unknown as Mock;
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
        listSharedWithMeMock.mockResolvedValue(listing([ entry(fileTarget('a')), entry(fileTarget('b')) ]));
        const store = useSharedStore();

        await store.load();

        expect(store.entries.map((item) => item.target.id)).toEqual([ 'a', 'b' ]);
        expect(store.error).toBeNull();
    });

    // Each filter change re-reads, and the older read is the less narrowed one: landing it last would show rows the
    // filters now on screen exclude.
    it('keeps the latest read when an earlier one answers last', async () =>
    {
        let answerEarlier : (value : { entries : SharedWithMeEntry[] }) => void = () => undefined;
        listSharedWithMeMock.mockResolvedValueOnce(listing([]));
        const store = useSharedStore();
        await store.load();

        listSharedWithMeMock
            .mockImplementationOnce(() => new Promise((resolve) => { answerEarlier = resolve; }))
            .mockResolvedValueOnce(listing([ entry(fileTarget('pdf')) ]));
        const earlier = store.setTypeFamilies([ 'images' ]);
        await store.setTypeFamilies([ 'pdfs' ]);
        answerEarlier(listing([ entry(fileTarget('image')) ]));
        await earlier;

        expect(store.entries.map((item) => item.target.id)).toEqual([ 'pdf' ]);
        expect(store.loading).toBe(false);
    });

    it('re-queries with the selected type families folded in and marks filters active', async () =>
    {
        listSharedWithMeMock.mockResolvedValue(listing([]));
        const store = useSharedStore();
        await store.load();

        await store.setTypeFamilies([ 'images', 'pdfs' ]);

        expect(store.typeFamilies).toEqual([ 'images', 'pdfs' ]);
        expect(store.hasActiveFilters).toBe(true);
        expect(listSharedWithMeMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ types: [ 'images', 'pdfs' ] })
        );
    });

    it('re-queries with a modified window when a preset is chosen', async () =>
    {
        listSharedWithMeMock.mockResolvedValue(listing([]));
        const store = useSharedStore();
        await store.load();

        await store.setModified({ kind: 'preset', preset: 'last7' });

        expect(listSharedWithMeMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ updatedAfter: expect.any(String) })
        );
    });

    it('drops every filter param on clearFilters', async () =>
    {
        listSharedWithMeMock.mockResolvedValue(listing([]));
        const store = useSharedStore();
        await store.load();
        await store.setTypeFamilies([ 'images' ]);
        await store.setModified({ kind: 'preset', preset: 'last7' });

        await store.clearFilters();

        expect(store.hasActiveFilters).toBe(false);
        const lastQuery = listSharedWithMeMock.mock.calls.at(-1)?.[0] ?? {};
        expect(lastQuery).not.toHaveProperty('types');
        expect(lastQuery).not.toHaveProperty('updatedAfter');
    });

    // An empty listing WITH an active filter is a distinct surface state from nothing being shared at all.
    it('reports filteredEmpty only when a filter is active and the listing is empty', async () =>
    {
        listSharedWithMeMock.mockResolvedValue(listing([]));
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
        listSharedWithMeMock.mockResolvedValue(listing([]));
        const store = useSharedStore();
        await store.load();
        await store.setTypeFamilies([ 'images' ]);
        expect(store.typeFamilies).toEqual([ 'images' ]);

        await store.load();

        expect(store.typeFamilies).toEqual([]);
        expect(store.hasActiveFilters).toBe(false);
        expect(listSharedWithMeMock.mock.calls.at(-1)?.[0] ?? {}).not.toHaveProperty('types');
    });
});

//----------------------------------------------------------------------------------------------------------------------
