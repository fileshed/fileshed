//----------------------------------------------------------------------------------------------------------------------
// Natural name ordering — the database and the client agreeing on one order
//
// Runs against whichever dialect the suite targets, so a full verification is two runs: SQLite orders these names in
// Node, Postgres in its ICU collation, and both are held to the same expectations here. The last test is the one that
// catches drift -- it compares the served order against the order the client's own sort would put the same nodes in,
// so no tier can move without the other two.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the seed builds snake_case DB rows (house convention for Kysely inserts) */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    LISTING_CHUNK_SIZE,
    type NodeListResponse,
    type NodeResponse,
    type NodeSortKey,
    nodeSortKeys,
} from '@fileshed/core';

// Client
import { sortNodes } from '@client/engines/listing/order.ts';

// Support
import { type BootedServeApp, ORIGIN, type TestUser, bootServeApp, makeUser } from '../publicLinks/support.ts';

//----------------------------------------------------------------------------------------------------------------------

// Ids are assigned so every tie group runs OPPOSITE to the order a wrong implementation would produce: a collation
// that separated case, accents, or leading zeros would have to reverse one of these groups to pass.
const FILES : readonly { id : string; name : string }[] = [
    // A digit run compares by value, and case never separates two names.
    { id: 'k-01', name: 'track-9.mp3' },
    { id: 'k-02', name: 'track-10.mp3' },
    { id: 'k-03', name: 'track-1.mp3' },
    { id: 'k-04', name: 'Track-2.mp3' },

    // Leading zeros do not change what a number is worth, so these three tie and the id decides.
    { id: 'k-05', name: 'file1.txt' },
    { id: 'k-06', name: 'file01.txt' },
    { id: 'k-07', name: 'file001.txt' },

    // Case ties.
    { id: 'k-08', name: 'APPLE.txt' },
    { id: 'k-09', name: 'Apple.txt' },
    { id: 'k-10', name: 'apple.txt' },

    // Accent ties.
    { id: 'k-11', name: 'café.txt' },
    { id: 'k-12', name: 'Café.txt' },
    { id: 'k-13', name: 'cafe.txt' },

    // A separator sits below the digits and letters it stands beside.
    { id: 'k-14', name: 'photo2.jpg' },
    { id: 'k-15', name: 'photo-2.jpg' },
    { id: 'k-16', name: 'photo_2.jpg' },
    { id: 'k-17', name: 'my.report.txt' },
    { id: 'k-18', name: 'my-report.txt' },
    { id: 'k-19', name: 'my_report.txt' },
    { id: 'k-20', name: 'a1.txt' },
    { id: 'k-21', name: 'a[1].txt' },
    { id: 'k-22', name: 'a(1).txt' },

    // Digit runs longer than any fixed-width padding could carry: thirteen digits, then forty and forty-one.
    { id: 'k-23', name: 'dump-1000000000000.sql' },
    { id: 'k-24', name: 'dump-999999999999.sql' },
    { id: 'k-25', name: 'dump-10000000000000000000000000000000000000000.sql' },
    { id: 'k-26', name: 'dump-9999999999999999999999999999999999999999.sql' },

    // A digit run at the front of a name and at the back of one.
    { id: 'k-27', name: '10lives.txt' },
    { id: 'k-28', name: '9lives.txt' },
    { id: 'k-29', name: 'lives10.txt' },
    { id: 'k-30', name: 'lives9.txt' },
];

const FOLDERS : readonly { id : string; name : string }[] = [
    { id: 'd-01', name: 'zzz-folder' },
    { id: 'd-02', name: 'aaa-folder' },
];

// Every file above carries the same size, timestamps and format, which makes them one enormous tie group under the
// other four keys -- good for proving the tiebreak, useless for proving the key. These vary on each in turn, and the
// link carries none of them: a pointer has no size and no format, which is the case the two tiers used to disagree
// about most.
const VARIED : readonly {
    id : string;
    name : string;
    size : number | null;
    mimeType : string | null;
    createdAt : string;
    updatedAt : string;
    type : 'file' | 'link';
}[] = [
    {
        id: 'v-01',
        name: 'v-huge.bin',
        size: 900_000,
        mimeType: 'application/octet-stream',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        type: 'file',
    },
    {
        id: 'v-02',
        name: 'v-tiny.txt',
        size: 1,
        mimeType: 'text/plain',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        type: 'file',
    },
    {
        id: 'v-03',
        name: 'v-empty.txt',
        size: 0,
        mimeType: 'text/plain',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
        type: 'file',
    },
    {
        id: 'v-04',
        name: 'v-clip.mp4',
        size: 5000,
        mimeType: 'video/mp4',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        type: 'file',
    },
    {
        id: 'v-05',
        name: 'v-pointer',
        size: null,
        mimeType: null,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
        type: 'link',
    },
];

const SHA256 = 'c'.repeat(64);

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedServeApp;
let owner : TestUser;

async function seed() : Promise<void>
{
    const now = new Date().toISOString();
    const backend = await booted.handle.db
        .selectFrom('storage_backend')
        .select('id')
        .executeTakeFirstOrThrow();

    await booted.handle.db
        .insertInto('blob')
        .values({
            sha256: SHA256,
            size: 10,
            backend_id: backend.id,
            storage_key: 'seed/natural',
            created_at: now,
            deleted_at: null,
        } as never)
        .execute();

    const rows = [
        ...FILES.map((file) => ({
            id: file.id,
            name: file.name,
            type: 'file' as const,
            owner_id: owner.id,
            parent_id: null,
            blob_id: SHA256,
            size: 10,
            mime_type: 'application/octet-stream',
            created_at: now,
            updated_at: now,
            trashed_at: null,
            target_node_id: null,
        })),
        ...VARIED.map((row) => ({
            id: row.id,
            name: row.name,
            type: row.type,
            owner_id: owner.id,
            parent_id: null,
            blob_id: row.type === 'file' ? SHA256 : null,
            size: row.size,
            mime_type: row.mimeType,
            created_at: row.createdAt,
            updated_at: row.updatedAt,
            trashed_at: null,
            target_node_id: row.type === 'link' ? 'k-01' : null,
        })),
        ...FOLDERS.map((folder) => ({
            id: folder.id,
            name: folder.name,
            type: 'folder' as const,
            owner_id: owner.id,
            parent_id: null,
            blob_id: null,
            size: null,
            mime_type: null,
            created_at: now,
            updated_at: now,
            trashed_at: null,
            target_node_id: null,
        })),
    ];

    await booted.handle.db
        .insertInto('node')
        .values(rows as never)
        .execute();
}

async function listing(
    direction : 'asc' | 'desc' = 'asc',
    sortKey : NodeSortKey = 'name'
) : Promise<NodeResponse[]>
{
    const res = await booted.app.request(
        `${ ORIGIN }/api/nodes/children?limit=${ LISTING_CHUNK_SIZE }&sortKey=${ sortKey }`
            + `&sortDirection=${ direction }`,
        { headers: { cookie: owner.cookie } }
    );
    const body = await res.json() as NodeListResponse;

    return body.nodes;
}

// The served names, narrowed to one group of the fixture so a test reads as the rule it is about.
function only(nodes : readonly NodeResponse[], names : readonly string[]) : string[]
{
    return nodes.map((node) => node.name).filter((name) => names.includes(name));
}

function positionOf(nodes : readonly NodeResponse[], name : string) : number
{
    return nodes.findIndex((node) => node.name === name);
}

//----------------------------------------------------------------------------------------------------------------------

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
    await seed();
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe('natural name ordering', () =>
{
    it('orders a digit run by its value, so track-9 comes before track-10', async () =>
    {
        const names = only(await listing(), [ 'track-1.mp3', 'Track-2.mp3', 'track-9.mp3', 'track-10.mp3' ]);

        expect(names).toEqual([ 'track-1.mp3', 'Track-2.mp3', 'track-9.mp3', 'track-10.mp3' ]);
    });

    it('reads a digit run at the front of a name as a number too', async () =>
    {
        const names = only(await listing(), [ '9lives.txt', '10lives.txt' ]);

        expect(names).toEqual([ '9lives.txt', '10lives.txt' ]);
    });

    it('reads a digit run at the end of a name as a number too', async () =>
    {
        const names = only(await listing(), [ 'lives9.txt', 'lives10.txt' ]);

        expect(names).toEqual([ 'lives9.txt', 'lives10.txt' ]);
    });

    it('counts leading zeros as the same number, leaving the id to break the tie', async () =>
    {
        const names = only(await listing(), [ 'file1.txt', 'file01.txt', 'file001.txt' ]);

        expect(names).toEqual([ 'file1.txt', 'file01.txt', 'file001.txt' ]);
    });

    it('never separates two names by case alone', async () =>
    {
        const names = only(await listing(), [ 'APPLE.txt', 'Apple.txt', 'apple.txt' ]);

        expect(names).toEqual([ 'APPLE.txt', 'Apple.txt', 'apple.txt' ]);
    });

    it('never separates two names by an accent alone', async () =>
    {
        const names = only(await listing(), [ 'café.txt', 'Café.txt', 'cafe.txt' ]);

        expect(names).toEqual([ 'café.txt', 'Café.txt', 'cafe.txt' ]);
    });

    it('sorts a separator below the digits and letters it stands beside', async () =>
    {
        const nodes = await listing();

        expect(positionOf(nodes, 'photo_2.jpg')).toBeLessThan(positionOf(nodes, 'photo2.jpg'));
        expect(positionOf(nodes, 'photo-2.jpg')).toBeLessThan(positionOf(nodes, 'photo2.jpg'));
        expect(positionOf(nodes, 'a(1).txt')).toBeLessThan(positionOf(nodes, 'a1.txt'));
        expect(positionOf(nodes, 'a[1].txt')).toBeLessThan(positionOf(nodes, 'a1.txt'));
    });

    it('compares a digit run longer than any fixed-width padding by value', async () =>
    {
        const names = only(await listing(), [
            'dump-999999999999.sql',
            'dump-1000000000000.sql',
            'dump-9999999999999999999999999999999999999999.sql',
            'dump-10000000000000000000000000000000000000000.sql',
        ]);

        expect(names).toEqual([
            'dump-999999999999.sql',
            'dump-1000000000000.sql',
            'dump-9999999999999999999999999999999999999999.sql',
            'dump-10000000000000000000000000000000000000000.sql',
        ]);
    });

    it('pins folders above the files whatever their names sort like', async () =>
    {
        const nodes = await listing();

        expect(nodes.slice(0, FOLDERS.length).map((node) => node.name)).toEqual([ 'aaa-folder', 'zzz-folder' ]);
    });

    it('keeps folders on top when the direction reverses', async () =>
    {
        const nodes = await listing('desc');

        expect(nodes.slice(0, FOLDERS.length).map((node) => node.name)).toEqual([ 'zzz-folder', 'aaa-folder' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

// The drift test. The client sorts a folder it holds whole, the database sorts one it does not, and a user scrolling
// past the ceiling sees both -- so the two orders have to be the same order, row for row and tie for tie. Every key
// in both directions, because the four that are not `name` order in SQL on one side and in JavaScript on the other,
// and nothing but this holds the two spellings together.
describe('listing order — server and client', () =>
{
    for(const sortKey of nodeSortKeys)
    {
        for(const direction of [ 'asc', 'desc' ] as const)
        {
            it(`serves ${ sortKey } ${ direction } in the order the client's own sort produces`, async () =>
            {
                const served = await listing(direction, sortKey);

                // Shuffled first, so a client sort that quietly preserved the input order could not pass by accident.
                const shuffled = [ ...served ].sort((left, right) =>
                {
                    return left.id < right.id ? 1 : -1;
                });

                const sorted = sortNodes(shuffled, sortKey, direction);

                expect(sorted.map((node) => node.id)).toEqual(served.map((node) => node.id));
            });
        }
    }
});

//----------------------------------------------------------------------------------------------------------------------
