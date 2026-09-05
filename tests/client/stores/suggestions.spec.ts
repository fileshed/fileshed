//----------------------------------------------------------------------------------------------------------------------
// Suggestions Store — debounced live search behind the top bar's box
//
// Typing settles before anything is asked of the server: a burst of keystrokes costs one query, not one per character.
// A term below the floor never queries at all. Every request carries an abort signal, and a superseded request's answer
// is discarded however late it lands -- otherwise a slow early keystroke could overwrite a fast later one and leave the
// dropdown showing suggestions for a word the caller finished typing seconds ago.
//----------------------------------------------------------------------------------------------------------------------

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { type NodeResponse, SUGGEST_LIMIT, type SearchResponse } from '@fileshed/core';

// Resource Access
import { search } from '@client/resource-access/search.ts';

// Under test
import { useSuggestionsStore } from '@client/stores/suggestions.ts';

//----------------------------------------------------------------------------------------------------------------------

vi.mock('@client/resource-access/search.ts', () => ({ search: vi.fn() }));

const searchMock = search as unknown as Mock;

const ISO = '2026-07-01T00:00:00.000Z';

function node(id : string, name : string) : NodeResponse
{
    return {
        sharing: null,
        id,
        name,
        ownerID: 'owner1',
        parentID: null,
        createdAt: ISO,
        updatedAt: ISO,
        role: 'owner',
        type: 'folder',
        trashedAt: null,
    };
}

function envelope(nodes : NodeResponse[]) : SearchResponse
{
    return {
        nodes,
        total: nodes.length,
        limit: SUGGEST_LIMIT,
        offset: 0,
        owners: [],
        locations: Object.fromEntries(nodes.map((entry) => [ entry.id, { crumbs: [], foreign: false } ])),
    };
}

// A promise the test resolves by hand, so two requests can be landed out of order on purpose.
function deferred() : { promise : Promise<SearchResponse>; resolve : (value : SearchResponse) => void }
{
    let resolve : (value : SearchResponse) => void = () => undefined;
    const promise = new Promise<SearchResponse>((res) => { resolve = res; });

    return { promise, resolve };
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(() =>
{
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());
});

afterEach(() => vi.useRealTimers());

//----------------------------------------------------------------------------------------------------------------------

describe('useSuggestionsStore.suggest', () =>
{
    it('waits for the typing to settle before asking the server', async () =>
    {
        const store = useSuggestionsStore();
        searchMock.mockResolvedValue(envelope([ node('n1', 'notes') ]));

        store.suggest('notes');
        expect(searchMock).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();

        expect(searchMock).toHaveBeenCalledTimes(1);
        expect(store.nodes.map((entry) => entry.id)).toEqual([ 'n1' ]);
    });

    // The point of the debounce: a word typed one character at a time is one query, not one per character.
    it('collapses a burst of keystrokes into a single query for the final term', async () =>
    {
        const store = useSuggestionsStore();
        searchMock.mockResolvedValue(envelope([]));

        store.suggest('n');
        store.suggest('no');
        store.suggest('not');
        store.suggest('note');
        await vi.runAllTimersAsync();

        expect(searchMock).toHaveBeenCalledTimes(1);
        expect(searchMock).toHaveBeenCalledWith('note', expect.objectContaining({ limit: SUGGEST_LIMIT }));
    });

    it('never queries for a term below the suggestion floor', async () =>
    {
        const store = useSuggestionsStore();

        store.suggest('n');
        await vi.runAllTimersAsync();

        expect(searchMock).not.toHaveBeenCalled();
        expect(store.nodes).toEqual([]);
    });

    // Backspacing below the floor has to clear what is on screen, or the dropdown keeps offering matches for a term
    // that is no longer in the box.
    it('drops standing suggestions when the term falls back below the floor', async () =>
    {
        const store = useSuggestionsStore();
        searchMock.mockResolvedValue(envelope([ node('n1', 'notes') ]));

        store.suggest('notes');
        await vi.runAllTimersAsync();
        expect(store.nodes).toHaveLength(1);

        store.suggest('n');
        await vi.runAllTimersAsync();

        expect(store.nodes).toEqual([]);
    });

    it('passes an abort signal so a superseded request can be cancelled', async () =>
    {
        const store = useSuggestionsStore();
        searchMock.mockResolvedValue(envelope([]));

        store.suggest('notes');
        await vi.runAllTimersAsync();

        expect(searchMock).toHaveBeenCalledWith('notes', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });

    // The failure this whole design exists to prevent: an early request landing AFTER a later one must not overwrite
    // the later one's results.
    it('discards a superseded request\'s results even when it lands last', async () =>
    {
        const store = useSuggestionsStore();
        const first = deferred();
        const second = deferred();
        searchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

        store.suggest('alpha');
        await vi.advanceTimersByTimeAsync(500);
        store.suggest('beta');
        await vi.advanceTimersByTimeAsync(500);

        // The newer query answers first, then the stale one arrives late.
        second.resolve(envelope([ node('beta1', 'beta-hit') ]));
        await vi.runAllTimersAsync();
        first.resolve(envelope([ node('alpha1', 'alpha-hit') ]));
        await vi.runAllTimersAsync();

        expect(store.nodes.map((entry) => entry.id)).toEqual([ 'beta1' ]);
    });

    // A failed request clears rather than freezing the previous term's matches under the new one.
    it('shows nothing when a query fails', async () =>
    {
        const store = useSuggestionsStore();
        searchMock.mockResolvedValueOnce(envelope([ node('n1', 'notes') ]));

        store.suggest('notes');
        await vi.runAllTimersAsync();
        expect(store.nodes).toHaveLength(1);

        searchMock.mockRejectedValueOnce(new Error('boom'));
        store.suggest('nothing');
        await vi.runAllTimersAsync();

        expect(store.nodes).toEqual([]);
        expect(store.loading).toBe(false);
    });

    // A query still pending when the box goes away must never land on a later mount.
    it('drops a pending query when cleared before it fires', async () =>
    {
        const store = useSuggestionsStore();
        searchMock.mockResolvedValue(envelope([ node('n1', 'notes') ]));

        store.suggest('notes');
        store.clear();
        await vi.runAllTimersAsync();

        expect(searchMock).not.toHaveBeenCalled();
        expect(store.term).toBe('');
        expect(store.nodes).toEqual([]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
