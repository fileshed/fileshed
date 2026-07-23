//----------------------------------------------------------------------------------------------------------------------
// Access Request DTOs -- the incoming list pairs each pending request with its requester's summary
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import {
    ACCESS_REQUEST_MESSAGE_MAX_CHARS,
    type ShareRequest,
    accessRequestListEntryCodec,
    accessRequestListResponseCodec,
    createAccessRequestCodec,
    toAccessRequestListEntry,
    toAccessRequestResponse,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

describe('createAccessRequestCodec', () =>
{
    it('accepts a request with no message', () =>
    {
        const result = createAccessRequestCodec.safeParse({ requestedRole: 'viewer' });

        expect(result.success).toBe(true);
        expect(result.success && result.data.message).toBeUndefined();
    });

    it('trims surrounding whitespace from a supplied message', () =>
    {
        const result = createAccessRequestCodec.safeParse({
            requestedRole: 'viewer',
            message: '  Could I get viewer access? ',
        });

        expect(result.success).toBe(true);
        expect(result.success && result.data.message).toBe('Could I get viewer access?');
    });

    // A blank message is the same as never having written one -- the wire shape omits the key entirely rather than
    // carrying an empty string, so the domain never has to distinguish "" from "no message".
    it('collapses a whitespace-only message to absent', () =>
    {
        const result = createAccessRequestCodec.safeParse({ requestedRole: 'viewer', message: '   ' });

        expect(result.success).toBe(true);
        expect(result.success && result.data.message).toBeUndefined();
    });

    it(`rejects a message over ${ ACCESS_REQUEST_MESSAGE_MAX_CHARS } characters`, () =>
    {
        const overCap = 'x'.repeat(ACCESS_REQUEST_MESSAGE_MAX_CHARS + 1);

        const result = createAccessRequestCodec.safeParse({ requestedRole: 'viewer', message: overCap });

        expect(result.success).toBe(false);
    });

    it(`accepts a message at exactly ${ ACCESS_REQUEST_MESSAGE_MAX_CHARS } characters`, () =>
    {
        const atCap = 'x'.repeat(ACCESS_REQUEST_MESSAGE_MAX_CHARS);

        const result = createAccessRequestCodec.safeParse({ requestedRole: 'viewer', message: atCap });

        expect(result.success).toBe(true);
    });
});

describe('accessRequestListEntryCodec', () =>
{
    const request = {
        id: 'req_1',
        nodeID: 'node_1',
        requesterID: 'user_2',
        requestedRole: 'viewer' as const,
        message: null,
        status: 'pending' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
    };
    const requester = { id: 'user_2', name: 'Grace Hopper', email: 'grace@example.com', image: null };

    it('accepts a pending request paired with its requester\'s summary', () =>
    {
        expect(accessRequestListEntryCodec.safeParse({ request, requester }).success).toBe(true);
    });

    // The whole point of the enrichment: an entry without a resolvable requester summary is not a valid entry, so a
    // regression back to the bare request is caught by the codec rather than shipping a placeholder-ready shape.
    it('rejects an entry with no requester summary', () =>
    {
        expect(accessRequestListEntryCodec.safeParse({ request }).success).toBe(false);
    });
});

describe('accessRequestListResponseCodec', () =>
{
    it('accepts an empty incoming and outgoing list', () =>
    {
        expect(accessRequestListResponseCodec.safeParse({ incoming: [], outgoing: [] }).success).toBe(true);
    });

    it('rejects an incoming list carrying bare requests without their requester summary', () =>
    {
        const bareRequest = {
            id: 'req_1',
            nodeID: 'node_1',
            requesterID: 'user_2',
            requestedRole: 'viewer',
            message: null,
            status: 'pending',
            createdAt: '2026-01-01T00:00:00.000Z',
            resolvedAt: null,
        };

        expect(accessRequestListResponseCodec.safeParse({
            incoming: [ bareRequest ],
            outgoing: [],
        }).success).toBe(false);
    });

    // Outgoing requests carry no enrichment -- the requester already knows who they asked, so the bare response is
    // the correct shape here.
    it('accepts an outgoing list of bare requests', () =>
    {
        const request = {
            id: 'req_1',
            nodeID: 'node_1',
            requesterID: 'user_2',
            requestedRole: 'viewer',
            message: null,
            status: 'pending',
            createdAt: '2026-01-01T00:00:00.000Z',
            resolvedAt: null,
        };

        expect(accessRequestListResponseCodec.safeParse({ incoming: [], outgoing: [ request ] }).success).toBe(true);
    });
});

describe('toAccessRequestListEntry', () =>
{
    it('pairs the serialized request with the supplied requester summary and satisfies the wire codec', () =>
    {
        const request : ShareRequest = {
            id: 'req_1',
            nodeID: 'node_1',
            requesterID: 'user_2',
            requestedRole: 'editor',
            message: 'Could you share this with me?',
            status: 'pending',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            resolvedAt: null,
        };
        const requester = { id: 'user_2', name: 'Grace Hopper', email: 'grace@example.com', image: null };

        const entry = toAccessRequestListEntry(request, requester);

        expect(entry).toEqual({ request: toAccessRequestResponse(request), requester });
        expect(accessRequestListEntryCodec.safeParse(entry).success).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
