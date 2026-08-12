//----------------------------------------------------------------------------------------------------------------------
// Listing Filter Engine
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import type { NodeResponse } from '@fileshed/core';

import { type ListingFilters, familyOf, filterNodes } from '@client/engines/listing/filter.ts';

//----------------------------------------------------------------------------------------------------------------------

const ISO = '2026-07-01T00:00:00.000Z';

const BASE = { ownerID: 'u1', parentID: null, createdAt: ISO, updatedAt: ISO, role: 'owner' as const };

const UNFILTERED : ListingFilters = { types: [], ownerID: null, after: null, before: null };

function file(id : string, mimeType : string, name : string = id, updatedAt : string = ISO) : NodeResponse
{
    return {
        ...BASE,
        id,
        name,
        updatedAt,
        type: 'file',
        blobID: 'b1',
        size: 100,
        mimeType,
        trashedAt: null,
        sharing: null,
    };
}

function folder(id : string) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'folder', trashedAt: null };
}

function link(id : string) : NodeResponse
{
    return { ...BASE, id, name: id, type: 'link', targetNodeID: 't1', target: null };
}

function ids(nodes : readonly NodeResponse[]) : string[]
{
    return nodes.map((node) => node.id);
}

//----------------------------------------------------------------------------------------------------------------------

describe('familyOf', () =>
{
    it('files a folder under folders and a link under links, whatever the link points at', () =>
    {
        expect(familyOf(folder('d'))).toBe('folders');
        expect(familyOf(link('l'))).toBe('links');
    });

    it('classifies a file by its mime type', () =>
    {
        expect(familyOf(file('a', 'image/png'))).toBe('images');
        expect(familyOf(file('b', 'application/pdf'))).toBe('pdfs');
        expect(familyOf(file('c', 'text/plain'))).toBe('documents');
        expect(familyOf(file('d', 'audio/mpeg'))).toBe('audio');
    });

    // Servers and browsers disagree about m3u mime types often enough that the extension is the better witness, so a
    // playlist reads as a playlist rather than as another audio file.
    it('carves playlists out of audio by mime or by name', () =>
    {
        expect(familyOf(file('m', 'audio/x-mpegurl'))).toBe('playlists');
        expect(familyOf(file('n', 'audio/mpeg', 'roadtrip.m3u8'))).toBe('playlists');
    });

    it('leaves an unclassifiable file in no family at all', () =>
    {
        expect(familyOf(file('x', 'application/x-unknown-thing'))).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('filterNodes', () =>
{
    it('keeps every row when nothing is filtering', () =>
    {
        const nodes = [ file('a', 'image/png'), folder('d'), link('l') ];

        expect(ids(filterNodes(nodes, UNFILTERED))).toEqual([ 'a', 'd', 'l' ]);
    });

    it('keeps the rows in any of the selected families', () =>
    {
        const nodes = [ file('pic', 'image/png'), file('doc', 'text/plain'), folder('d') ];

        const kept = filterNodes(nodes, { ...UNFILTERED, types: [ 'images', 'folders' ] });

        expect(ids(kept)).toEqual([ 'pic', 'd' ]);
    });

    it('drops a file whose mime belongs to no family when any family is selected', () =>
    {
        const nodes = [ file('mystery', 'application/x-unknown-thing') ];

        expect(filterNodes(nodes, { ...UNFILTERED, types: [ 'documents' ] })).toEqual([]);
    });

    // Filtering by Audio must not surface the playlists the Playlists family exists to tell apart.
    it('keeps a playlist out of the audio family', () =>
    {
        const nodes = [ file('song', 'audio/mpeg'), file('mix', 'audio/mpeg', 'summer.m3u') ];

        expect(ids(filterNodes(nodes, { ...UNFILTERED, types: [ 'audio' ] }))).toEqual([ 'song' ]);
        expect(ids(filterNodes(nodes, { ...UNFILTERED, types: [ 'playlists' ] }))).toEqual([ 'mix' ]);
    });

    // The owner filter matches the row's own owner -- a link belongs to whoever placed it, not to whoever owns the
    // node it points at.
    it('keeps only the named owner\'s rows', () =>
    {
        const mine = file('mine', 'text/plain');
        const theirs = { ...file('theirs', 'text/plain'), ownerID: 'u2' };

        expect(ids(filterNodes([ mine, theirs ], { ...UNFILTERED, ownerID: 'u2' }))).toEqual([ 'theirs' ]);
    });

    // The modified window is half-open: at or after `after`, strictly before `before`.
    it('keeps rows inside the modified window and excludes its upper bound', () =>
    {
        const nodes = [
            file('before', 'text/plain', 'before', '2026-05-31T23:59:59.000Z'),
            file('start', 'text/plain', 'start', '2026-06-01T00:00:00.000Z'),
            file('inside', 'text/plain', 'inside', '2026-06-15T00:00:00.000Z'),
            file('end', 'text/plain', 'end', '2026-07-01T00:00:00.000Z'),
        ];

        const kept = filterNodes(nodes, {
            ...UNFILTERED,
            after: '2026-06-01T00:00:00.000Z',
            before: '2026-07-01T00:00:00.000Z',
        });

        expect(ids(kept)).toEqual([ 'start', 'inside' ]);
    });

    it('applies every active filter together', () =>
    {
        const nodes = [
            file('keep', 'image/png', 'keep', '2026-06-15T00:00:00.000Z'),
            file('wrongType', 'text/plain', 'wrongType', '2026-06-15T00:00:00.000Z'),
            { ...file('wrongOwner', 'image/png', 'wrongOwner', '2026-06-15T00:00:00.000Z'), ownerID: 'u2' },
            file('wrongDate', 'image/png', 'wrongDate', '2026-01-01T00:00:00.000Z'),
        ];

        const kept = filterNodes(nodes, {
            types: [ 'images' ],
            ownerID: 'u1',
            after: '2026-06-01T00:00:00.000Z',
            before: null,
        });

        expect(ids(kept)).toEqual([ 'keep' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
