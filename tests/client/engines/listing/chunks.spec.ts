//----------------------------------------------------------------------------------------------------------------------
// Listing Chunks Engine
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { LISTING_FETCH_MARGIN, MAX_COMPLETE_LISTING } from '@fileshed/core';

import { isCapped, isComplete, reachesEnd, shouldPrefetch } from '@client/engines/listing/chunks.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('isCapped', () =>
{
    it('admits a listing at the ceiling and refuses one past it', () =>
    {
        expect(isCapped(MAX_COMPLETE_LISTING)).toBe(false);
        expect(isCapped(MAX_COMPLETE_LISTING + 1)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('isComplete', () =>
{
    it('is complete once every row of the listing is in hand', () =>
    {
        expect(isComplete(2500, 2500)).toBe(true);
    });

    it('is incomplete while rows are still missing', () =>
    {
        expect(isComplete(1000, 2500)).toBe(false);
    });

    // An empty folder is whole the moment it answers: there is nothing else to wait for.
    it('counts an empty listing as complete', () =>
    {
        expect(isComplete(0, 0)).toBe(true);
    });

    // Past the ceiling the client is not holding the listing whole even if every row happened to arrive, so sorting
    // and filtering stay the server's.
    it('never calls a listing past the ceiling complete', () =>
    {
        const past = MAX_COMPLETE_LISTING + 1;

        expect(isComplete(past, past)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('shouldPrefetch', () =>
{
    it('keeps pulling while a listing within the ceiling is short of its total', () =>
    {
        expect(shouldPrefetch(1000, 2500)).toBe(true);
    });

    it('stops once the listing is whole', () =>
    {
        expect(shouldPrefetch(2500, 2500)).toBe(false);
    });

    it('never pulls ahead on a listing past the ceiling', () =>
    {
        expect(shouldPrefetch(1000, MAX_COMPLETE_LISTING + 1)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('reachesEnd', () =>
{
    const total = MAX_COMPLETE_LISTING + 1;

    it('asks for more once the rendering comes within the margin of the loaded edge', () =>
    {
        expect(reachesEnd(1000 - LISTING_FETCH_MARGIN, 1000, total)).toBe(true);
    });

    it('stays quiet while the rendering is further back than the margin', () =>
    {
        expect(reachesEnd(1000 - LISTING_FETCH_MARGIN - 1, 1000, total)).toBe(false);
    });

    it('has nothing to ask for when everything is already loaded', () =>
    {
        expect(reachesEnd(2499, 2500, 2500)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
