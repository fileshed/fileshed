//----------------------------------------------------------------------------------------------------------------------
// Search Store
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { SearchResponse } from '@fileshed/core';

// Resource Access
import { search } from '@client/resource-access/search.ts';

// Stores
import { useSearchStore } from '@client/stores/search.ts';

// Support
import { fileNode } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/search.ts', () => ({ search: vi.fn() }));
vi.mock('@client/resource-access/nodes.ts', () => ({ copyNode: vi.fn(), hardDeleteNode: vi.fn(), trashNode: vi.fn() }));

const searchMock = search as unknown as Mock;

function hits(...ids : string[]) : SearchResponse
{
    return {
        nodes: ids.map((id) => fileNode({ id })),
        total: ids.length,
        limit: 100,
        offset: 0,
        owners: [],
        locations: {},
    };
}

beforeEach(() =>
{
    vi.clearAllMocks();
    setActivePinia(createPinia());
});

//----------------------------------------------------------------------------------------------------------------------

describe('useSearchStore', () =>
{
    it('lists the hits a term finds', async () =>
    {
        searchMock.mockResolvedValue(hits('a', 'b'));
        const store = useSearchStore();

        await store.load('report');

        expect(store.nodes.map((node) => node.id)).toEqual([ 'a', 'b' ]);
        expect(store.total).toBe(2);
        expect(store.loading).toBe(false);
    });

    it('shows the latest term\'s hits when an earlier search answers last', async () =>
    {
        let answerEarlier : (page : SearchResponse) => void = () => undefined;
        searchMock
            .mockImplementationOnce(() => new Promise((resolve) => { answerEarlier = resolve; }))
            .mockResolvedValueOnce(hits('reports'));
        const store = useSearchStore();

        const earlier = store.load('rep');
        await store.load('reports');
        answerEarlier(hits('rep1', 'rep2'));
        await earlier;

        expect(store.q).toBe('reports');
        expect(store.nodes.map((node) => node.id)).toEqual([ 'reports' ]);
        expect(store.loading).toBe(false);
    });

    it('stays clear when a search still in flight answers after the clear', async () =>
    {
        let answer : (page : SearchResponse) => void = () => undefined;
        searchMock.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
        const store = useSearchStore();

        const loading = store.load('report');
        store.clear();
        answer(hits('a'));
        await loading;

        expect(store.q).toBe('');
        expect(store.nodes).toEqual([]);
        expect(store.loading).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
