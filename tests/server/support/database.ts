//----------------------------------------------------------------------------------------------------------------------
// Test Database Provisioning
//
// One seam for every server spec that needs a database. Unset, FILESHED_TEST_DATABASE_URL leaves each spec on the
// in-memory SQLite it has always used, so local development needs nothing. Set, it points the suite at a real
// Postgres server and every boot gets its OWN freshly created database there -- a cuid-suffixed name, so vitest's
// parallel workers cannot collide -- dropped again on teardown.
//
// Most specs boot a database and never explicitly give it back -- harmless when it is in-memory SQLite, but on
// Postgres it would leak both the database and the pool's connections. Every provisioned database is therefore
// registered here and reclaimed by an afterEach net (support/setup.ts), which bounds what a run holds open to a
// single test's worth. Nothing under tests/server provisions in beforeAll, so per-test reclamation is safe.
//----------------------------------------------------------------------------------------------------------------------

import { Client } from 'pg';

import { createId } from '@paralleldrive/cuid2';

// Resource Access
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';

// Utils
import type { Config } from '@server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

const ADMIN_URL = process.env.FILESHED_TEST_DATABASE_URL;

// The dialect this run targets. Mirrors the handle's own `kind`, but answerable before a handle exists -- which is
// what a fixture needs when the value it is about to bind depends on the dialect (a boolean, a column type).
export function testDatabaseKind() : Config['DATABASE_KIND']
{
    return ADMIN_URL ? 'postgres' : 'sqlite';
}

//----------------------------------------------------------------------------------------------------------------------

export interface TestDatabase
{
    // The config the database was actually opened with. On a Postgres run this is the caller's config with the dialect
    // fields rewritten, so whatever the caller hands to createAuth/composeFullApp describes the live connection.
    config : Config;
    handle : DatabaseHandle;
    dispose : () => Promise<void>;
}

//----------------------------------------------------------------------------------------------------------------------

async function onAdmin(run : (client : Client) => Promise<void>) : Promise<void>
{
    const client = new Client({ connectionString: ADMIN_URL });

    await client.connect();

    try { await run(client); }
    finally { await client.end(); }
}

// Swap the database name into the admin URL, keeping credentials, host and query parameters exactly as given.
function urlFor(database : string) : string
{
    const url = new URL(ADMIN_URL ?? '');
    url.pathname = `/${ database }`;

    return url.toString();
}

//----------------------------------------------------------------------------------------------------------------------

const provisioned = new Map<string, DatabaseHandle>();

const DESTROY_TIMEOUT_MS = 5000;

// Closing the pool comes first, so that by the time the drop runs there is nothing left attached to object to it:
// terminating a live connection makes pg raise on the client, which surfaces as an unhandled error rather than
// anything a spec can catch. A spec that already closed its own pool is the normal case, not an error.
//
// The timeout is the escape hatch. pool.end() waits on whatever query is still outstanding, and a spec that failed
// mid-flight can leave one that never settles -- so reclamation stops waiting and lets FORCE sever it instead.
async function release(database : string, handle : DatabaseHandle) : Promise<void>
{
    provisioned.delete(database);

    const closed = handle.db.destroy().then(() => true, () => true);
    const timedOut = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DESTROY_TIMEOUT_MS));

    await Promise.race([ closed, timedOut ]);

    await onAdmin(async (client) =>
    {
        await client.query(`drop database if exists "${ database }" with (force)`);
    });
}

// The afterEach net. Reclaims every database provisioned since the last sweep, whatever the specs did or failed to do.
export async function dropProvisionedDatabases() : Promise<void>
{
    const entries = [ ...provisioned.entries() ];
    provisioned.clear();

    await Promise.all(entries.map(([ database, handle ]) => release(database, handle)));
}

//----------------------------------------------------------------------------------------------------------------------

export async function openTestDatabase(config : Config) : Promise<TestDatabase>
{
    if(!ADMIN_URL)
    {
        const handle = createDatabase(config);

        return { config, handle, dispose: () => handle.db.destroy() };
    }

    const database = `fileshed_test_${ createId() }`;

    await onAdmin(async (client) =>
    {
        await client.query(`create database "${ database }"`);
    });

    const postgresConfig : Config = { ...config, DATABASE_KIND: 'postgres', DATABASE_URL: urlFor(database) };
    const handle = createDatabase(postgresConfig);

    provisioned.set(database, handle);

    return { config: postgresConfig, handle, dispose: () => release(database, handle) };
}

//----------------------------------------------------------------------------------------------------------------------
