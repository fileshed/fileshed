//----------------------------------------------------------------------------------------------------------------------
// Big-folder timing — what the listing costs at the sizes the UI has to survive
//
// Not a pass/fail contract: a measurement, run against the real serving app on whichever dialect the suite targets, so
// the virtualized listing is designed against numbers rather than guesses. Seeds nodes straight through the RA, then
// times the listing endpoint a page at a time and once at the deepest offset.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- the seed builds snake_case DB rows (house convention for Kysely inserts) */

import { appendFileSync } from 'node:fs';

import { createId } from '@paralleldrive/cuid2';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LISTING_CHUNK_SIZE, type NodeListResponse } from '@fileshed/core';

// Support
import { type BootedServeApp, ORIGIN, type TestUser, bootServeApp, makeUser } from '../publicLinks/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const SIZES = [ 500, 10_000 ];

const REPORT = '/private/tmp/claude-501/-Users-morgul-devel-fileshed/'
    + 'b78f54de-fa10-474c-ad46-2d3791b4d305/scratchpad/bigfolder.txt';

let booted : BootedServeApp;
let owner : TestUser;

beforeEach(async () =>
{
    booted = await bootServeApp();
    owner = await makeUser(booted, 'owner@example.com');
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

// Straight into the table: the point is the read cost, and going through the upload flow for ten thousand files would
// measure the seeding instead.
async function seedFiles(count : number, parentID : string | null) : Promise<void>
{
    const now = new Date().toISOString();

    // Every seeded file points at one real blob row -- node.blob_id is a foreign key, and what is being measured is
    // the listing, not storage.
    const sha256 = 'b'.repeat(64);
    const backend = await booted.handle.db
        .selectFrom('storage_backend')
        .select('id')
        .executeTakeFirstOrThrow();
    await booted.handle.db
        .insertInto('blob')
        .values({
            sha256,
            size: 4_000_000,
            backend_id: backend.id,
            storage_key: 'seed/bench',
            created_at: now,
            deleted_at: null,
        } as never)
        .execute();

    const rows = Array.from({ length: count }, (_unused, index) => ({
        id: createId(),
        name: `track-${ String(index).padStart(5, '0') }.mp3`,
        type: 'file' as const,
        owner_id: owner.id,
        parent_id: parentID,
        blob_id: sha256,
        size: 4_000_000,
        mime_type: 'audio/mpeg',
        created_at: now,
        updated_at: now,
        trashed_at: null,
        target_node_id: null,
    }));

    for(let at = 0; at < rows.length; at += 500)
    {
        // One batch at a time on purpose: SQLite has a bound-parameter ceiling, and the seeding is not what is being
        // measured, so there is nothing to gain by racing the inserts.
        // eslint-disable-next-line no-await-in-loop
        await booted.handle.db
            .insertInto('node')
            .values(rows.slice(at, at + 500) as never)
            .execute();
    }
}

async function timeListing(path : string) : Promise<{ ms : number; body : NodeListResponse }>
{
    const started = performance.now();
    const res = await booted.app.request(`${ ORIGIN }${ path }`, { headers: { cookie: owner.cookie } });
    const body = await res.json() as NodeListResponse;

    return { ms: performance.now() - started, body };
}

//----------------------------------------------------------------------------------------------------------------------

describe('listing cost by folder size', () =>
{
    for(const size of SIZES)
    {
        it(`times a ${ size }-node folder`, async () =>
        {
            await seedFiles(size, null);

            const first = await timeListing(`/api/nodes/children?limit=${ LISTING_CHUNK_SIZE }&offset=0`);
            const deepOffset = Math.max(0, size - LISTING_CHUNK_SIZE);
            const deep = await timeListing(
                `/api/nodes/children?limit=${ LISTING_CHUNK_SIZE }&offset=${ deepOffset }`
            );

            // What opening the folder actually costs the client: chunk after chunk until the whole folder is in hand.
            const started = performance.now();
            let loaded = 0;
            let requests = 0;
            while(loaded < size)
            {
                // eslint-disable-next-line no-await-in-loop
                const chunk = await timeListing(
                    `/api/nodes/children?limit=${ LISTING_CHUNK_SIZE }&offset=${ loaded }`
                );
                loaded += chunk.body.nodes.length;
                requests += 1;
            }
            const wholeMs = performance.now() - started;

            const perNode = Math.round(JSON.stringify(first.body.nodes).length / first.body.nodes.length);

            appendFileSync(
                REPORT,
                `\n  ${ size } nodes: total=${ first.body.total }`
                + `\n    first chunk (${ LISTING_CHUNK_SIZE }): ${ first.ms.toFixed(0) }ms`
                + `\n    deep chunk  (${ LISTING_CHUNK_SIZE }): ${ deep.ms.toFixed(0) }ms  @offset ${ deepOffset }`
                + `\n    whole folder:           ${ wholeMs.toFixed(0) }ms over ${ requests } request(s)`
                + `\n    ~bytes per node:        ${ perNode }`
                + `\n    ~whole folder:          ${ (perNode * size / 1_000_000).toFixed(1) } MB\n`
            );

            expect(first.body.total).toBe(size);
            expect(loaded).toBe(size);
        }, 120_000);
    }
});

//----------------------------------------------------------------------------------------------------------------------
