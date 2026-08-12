//----------------------------------------------------------------------------------------------------------------------
// Listing Order Engine
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { NodeResponse } from '@fileshed/core';

import { sortNodes } from '@client/engines/listing/order.ts';

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

const BASE = { ownerID: 'u1', parentID: null, createdAt: ISO, updatedAt: ISO, role: 'owner' as const };

interface FileFacts
{
    name ?: string;
    size ?: number;
    mimeType ?: string;
    updatedAt ?: string;
    createdAt ?: string;
}

function file(id : string, facts : FileFacts = {}) : NodeResponse
{
    return {
        ...BASE,
        id,
        name: facts.name ?? id,
        type: 'file',
        blobID: 'b1',
        size: facts.size ?? 100,
        mimeType: facts.mimeType ?? 'text/plain',
        trashedAt: null,
        sharing: null,
        updatedAt: facts.updatedAt ?? ISO,
        createdAt: facts.createdAt ?? ISO,
    };
}

function folder(id : string, name : string = id) : NodeResponse
{
    return { ...BASE, id, name, type: 'folder', trashedAt: null };
}

function link(id : string, name : string = id) : NodeResponse
{
    return { ...BASE, id, name, type: 'link', targetNodeID: 't1', target: null };
}

function order(nodes : readonly NodeResponse[]) : string[]
{
    return nodes.map((node) => node.id);
}

//----------------------------------------------------------------------------------------------------------------------

describe('sortNodes', () =>
{
    it('puts folders ahead of everything else, ascending or descending', () =>
    {
        const nodes = [ file('f'), folder('d'), link('l') ];

        expect(order(sortNodes(nodes, 'name', 'asc'))[0]).toBe('d');
        expect(order(sortNodes(nodes, 'name', 'desc'))[0]).toBe('d');
    });

    it('orders names without regard to case', () =>
    {
        const nodes = [ file('z', { name: 'apple' }), file('a', { name: 'Banana' }), file('m', { name: 'Cherry' }) ];

        expect(order(sortNodes(nodes, 'name', 'asc'))).toEqual([ 'z', 'a', 'm' ]);
    });

    // A folder of tracks numbers them, and 9 comes before 10 to a person reading the screen.
    it('orders the digits inside a name as numbers', () =>
    {
        const nodes = [ file('ten', { name: 'track-10' }), file('nine', { name: 'track-9' }) ];

        expect(order(sortNodes(nodes, 'name', 'asc'))).toEqual([ 'nine', 'ten' ]);
    });

    it('reverses the order when the direction flips', () =>
    {
        const nodes = [ file('a'), file('b'), file('c') ];

        expect(order(sortNodes(nodes, 'name', 'desc'))).toEqual([ 'c', 'b', 'a' ]);
    });

    it('orders by size, counting a link as carrying no bytes of its own', () =>
    {
        const nodes = [ file('big', { size: 900 }), link('pointer'), file('small', { size: 10 }) ];

        expect(order(sortNodes(nodes, 'size', 'asc'))).toEqual([ 'pointer', 'small', 'big' ]);
    });

    it('orders by modified time, newest last ascending', () =>
    {
        const nodes = [
            file('newer', { updatedAt: '2026-07-05T00:00:00.000Z' }),
            file('older', { updatedAt: '2026-01-02T00:00:00.000Z' }),
        ];

        expect(order(sortNodes(nodes, 'updatedAt', 'asc'))).toEqual([ 'older', 'newer' ]);
    });

    it('orders by created time independently of modified time', () =>
    {
        const nodes = [
            file('second', { createdAt: '2026-07-05T00:00:00.000Z' }),
            file('first', { createdAt: '2026-01-02T00:00:00.000Z' }),
        ];

        expect(order(sortNodes(nodes, 'createdAt', 'asc'))).toEqual([ 'first', 'second' ]);
    });

    // Kind groups files by format and keeps links together, so a folder of mixed content reads by type.
    it('groups by kind, files by their format and links behind them', () =>
    {
        const nodes = [ link('l'), file('pic', { mimeType: 'image/png' }), file('doc', { mimeType: 'text/plain' }) ];

        expect(order(sortNodes(nodes, 'kind', 'asc'))).toEqual([ 'pic', 'doc', 'l' ]);
    });

    // Two rows the key cannot separate must land in one fixed order, or re-sorting would shuffle equals under the
    // user's cursor.
    it('breaks a tie the same way every time', () =>
    {
        const nodes = [ file('c', { name: 'same', size: 5 }), file('a', { name: 'same', size: 5 }) ];

        expect(order(sortNodes(nodes, 'size', 'asc'))).toEqual([ 'a', 'c' ]);
        expect(order(sortNodes([ ...nodes ].reverse(), 'size', 'asc'))).toEqual([ 'a', 'c' ]);
    });

    it('leaves the listing it was handed untouched', () =>
    {
        const nodes = [ file('b'), file('a') ];

        sortNodes(nodes, 'name', 'asc');

        expect(order(nodes)).toEqual([ 'b', 'a' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
