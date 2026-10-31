//----------------------------------------------------------------------------------------------------------------------
// Chunked Listing
//
// Driven over an in-memory source of numbered rows, so each expectation is a row count a reader can check by hand.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { MAX_COMPLETE_LISTING, type NodeListResponse } from '@fileshed/core';

// Stores
import { type ChunkedListingSource, createChunkedListing } from '@client/stores/chunkedListing.ts';

// Support
import { fileNode } from '../support.ts';

//----------------------------------------------------------------------------------------------------------------------

interface Deferred
{
    promise : Promise<NodeListResponse>;
    resolve(page : NodeListResponse) : void;
}

function deferred() : Deferred
{
    let resolve : (page : NodeListResponse) => void = () => undefined;
    const promise = new Promise<NodeListResponse>((settle) => { resolve = settle; });

    return { promise, resolve };
}

// `count` rows from `offset` out of a listing of `total`.
function page(offset : number, count : number, total : number) : NodeListResponse
{
    const nodes = Array.from({ length: count }, (_, index) => fileNode({ id: `n${ offset + index }` }));

    return { nodes, total, limit: count, offset, owners: [] };
}

// A listing of `total` rows served `chunk` at a time.
function rowsSource(total : number, chunk : number) : ChunkedListingSource & { listChunk : ReturnType<typeof vi.fn> }
{
    return {
        listChunk: vi.fn(async (offset : number) => page(offset, Math.max(0, Math.min(chunk, total - offset)), total)),
    };
}

//----------------------------------------------------------------------------------------------------------------------

describe('createChunkedListing', () =>
{
    it('fills a listing within the ceiling behind its first chunk until it is whole', async () =>
    {
        const rows = createChunkedListing(rowsSource(5, 2));
        const token = rows.begin();

        await rows.replaceWithFirstChunk(token, false);
        expect(rows.loaded.value).toHaveLength(2);

        await rows.fillRest(token);

        expect(rows.loaded.value.map((node) => node.id)).toEqual([ 'n0', 'n1', 'n2', 'n3', 'n4' ]);
        expect(rows.complete.value).toBe(true);
        expect(rows.whole.value).toBe(true);
    });

    it('lands nothing from a first read that a newer read superseded', async () =>
    {
        const slow = deferred();
        const rows = createChunkedListing({ listChunk: () => slow.promise });

        const reading = rows.replaceWithFirstChunk(rows.begin(), false);
        rows.begin();
        slow.resolve(page(0, 3, 3));

        expect(await reading).toBe(false);
        expect(rows.loaded.value).toEqual([]);
    });

    it('stops filling when a chunk comes back empty short of the total', async () =>
    {
        const source = rowsSource(4, 2);
        source.listChunk.mockImplementation(async (offset : number) => page(offset, offset < 4 ? 2 : 0, 10));
        const rows = createChunkedListing(source);
        const token = rows.begin();

        await rows.replaceWithFirstChunk(token, false);
        await rows.fillRest(token);

        expect(rows.loaded.value).toHaveLength(4);
        expect(rows.complete.value).toBe(false);
    });

    it('leaves the listing short when a chunk fails, and picks it up as the reader nears the end', async () =>
    {
        const source = rowsSource(4, 2);
        source.listChunk.mockRejectedValueOnce(new Error('offline'));
        const rows = createChunkedListing(source);
        const token = rows.begin();
        await rows.replaceWithFirstChunk(token, false).catch(() => undefined);
        await rows.replaceWithFirstChunk(token, false);

        source.listChunk.mockRejectedValueOnce(new Error('offline'));
        await rows.fillRest(token);
        expect(rows.loaded.value).toHaveLength(2);

        rows.reachedIndex(1);

        await vi.waitFor(() => { expect(rows.loaded.value).toHaveLength(4); });
    });

    // A reader who opens a folder while the previous folder's chunk is still on the wire must still get the new folder
    // whole, or its sort and filter changes would go back to the server instead of working on the rows in hand.
    it('never holds the current listing behind a chunk still in flight for the previous one', async () =>
    {
        const stuck = deferred();
        const source = rowsSource(4, 2);
        const rows = createChunkedListing(source);

        const first = rows.begin();
        await rows.replaceWithFirstChunk(first, false);
        source.listChunk.mockImplementationOnce(() => stuck.promise);
        const abandoned = rows.fillRest(first);

        const second = rows.begin();
        await rows.replaceWithFirstChunk(second, false);
        await rows.fillRest(second);

        expect(rows.loaded.value).toHaveLength(4);
        expect(rows.whole.value).toBe(true);

        stuck.resolve(page(2, 2, 4));
        await abandoned;
        expect(rows.loaded.value).toHaveLength(4);
    });

    it('leaves a listing past the ceiling to load as the reader scrolls', async () =>
    {
        const rows = createChunkedListing(rowsSource(MAX_COMPLETE_LISTING + 1, 10));
        const token = rows.begin();

        await rows.replaceWithFirstChunk(token, false);
        await rows.fillRest(token);

        expect(rows.loaded.value).toHaveLength(10);
        expect(rows.capped.value).toBe(true);

        rows.reachedIndex(9);

        await vi.waitFor(() => { expect(rows.loaded.value).toHaveLength(20); });
    });

    it('filters a whole listing locally and a capped one on the server', async () =>
    {
        const small = createChunkedListing(rowsSource(3, 3));
        const large = createChunkedListing(rowsSource(MAX_COMPLETE_LISTING + 1, 10));

        await small.refresh(false);
        await large.refresh(false);

        expect(small.shouldFilterOnServer(true)).toBe(false);
        expect(large.shouldFilterOnServer(true)).toBe(true);
        expect(large.shouldFilterOnServer(false)).toBe(false);
    });

    it('treats rows read with the filters as narrowed, never whole', async () =>
    {
        const rows = createChunkedListing(rowsSource(3, 3));

        await rows.refresh(true);

        expect(rows.complete.value).toBe(true);
        expect(rows.whole.value).toBe(false);
        expect(rows.shouldFilterOnServer(true)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
