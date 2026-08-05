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

export async function onAdmin(run : (client : Client) => Promise<void>) : Promise<void>
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

// How long a pool gets to shut down, and how long the server then gets to report the last of its backends gone.
// Both are escape hatches from a spec that wedged a connection; healthy reclamation costs a single round-trip.
const CLOSE_TIMEOUT_MS = 5000;
const DRAIN_TIMEOUT_MS = 5000;
const DRAIN_POLL_MS = 20;

// The net's own budget, since it can spend both of the above in a row and a spec's hook cannot be given a budget
// from here. Disposing a database is deliberately the cheaper half -- closing the pool, nothing more -- so a spec's
// own cleanup stays inside the allowance vitest gives it.
export const RECLAIM_TIMEOUT_MS = 30_000;

//----------------------------------------------------------------------------------------------------------------------

async function withDeadline(work : Promise<unknown>, ms : number) : Promise<void>
{
    let timer : ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });

    try { await Promise.race([ work, deadline ]); }
    finally { clearTimeout(timer); }
}

function sleep(ms : number) : Promise<void>
{
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Kysely's destroy() resolves when pg-pool has unlinked its clients, which is at least a tick before their sockets
// are actually closed -- pg-pool drops each client from its bookkeeping array and only then calls client.end().
// So a resolved destroy() means "no new queries", never "the server has let go".
async function closePool(handle : DatabaseHandle) : Promise<void>
{
    await withDeadline(handle.db.destroy().catch(() => undefined), CLOSE_TIMEOUT_MS);
}

async function backendsOn(client : Client, database : string) : Promise<number>
{
    const result = await client.query<{ backends : number }>(
        'select count(*)::int as backends from pg_stat_activity where datname = $1',
        [ database ]
    );

    return result.rows[0]?.backends ?? 0;
}

// The only place a test database is ever dropped, and it asks Postgres first -- the one witness that can actually
// answer whether this process has let go, since a resolved destroy() cannot. FORCE would sever whatever connection
// was still open, and pg answers a severed connection with a FATAL 57P01 on a client nobody is listening to: an
// unhandled error that fails a run whose every test passed.
export async function reclaimIfUnused(client : Client, database : string) : Promise<boolean>
{
    if(await backendsOn(client, database) > 0) { return false; }

    await client.query(`drop database if exists "${ database }"`);

    return true;
}

// Nothing re-opens a reclaimed database, so retrying only ever gets closer to succeeding.
async function reclaimUntilUnused(client : Client, database : string, deadline : number) : Promise<boolean>
{
    if(await reclaimIfUnused(client, database)) { return true; }
    if(Date.now() >= deadline) { return false; }

    await sleep(DRAIN_POLL_MS);

    return reclaimUntilUnused(client, database, deadline);
}

// Refusing to force means a wedged connection leaves its database behind instead of crashing the run. It is an
// orphan then, and the next run's sweep reclaims it.
async function dropWhenUnused(client : Client, database : string) : Promise<void>
{
    if(!await reclaimUntilUnused(client, database, Date.now() + DRAIN_TIMEOUT_MS))
    {
        process.stderr.write(`test database ${ database } still has connections; left for the next run's sweep\n`);
    }
}

// The afterEach net. Reclaims every database provisioned since the last sweep, whatever the specs did or failed to do.
export async function dropProvisionedDatabases() : Promise<void>
{
    const entries = [ ...provisioned.entries() ];
    provisioned.clear();

    if(entries.length === 0) { return; }

    await Promise.all(entries.map(([ , handle ]) => closePool(handle)));

    await onAdmin(async (client) =>
    {
        await Promise.all(entries.map(([ database ]) => dropWhenUnused(client, database)));
    });
}

// Reclaims what runs that died mid-flight left behind. It runs before any worker has provisioned a database, so
// every name it finds belongs to some earlier run -- and a dead run holds no connections, which is exactly the
// condition the drop below requires. A second suite running against the same server is safe for the same reason:
// Postgres refuses to drop a database anyone is attached to, so the worst this can do to it is nothing.
export async function dropOrphanedDatabases() : Promise<void>
{
    if(!ADMIN_URL) { return; }

    await onAdmin(async (client) =>
    {
        const orphans = await client.query<{ datname : string }>(
            "select datname from pg_database where datname like 'fileshed\\_test\\_%'"
        );

        await Promise.all(orphans.rows.map(({ datname }) => reclaimIfUnused(client, datname)));
    });
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

    // Giving a database back means letting go of its connections; the net does the dropping, moments later and on
    // its own budget. Splitting it that way keeps a spec's own cleanup hook off the wire.
    return { config: postgresConfig, handle, dispose: () => closePool(handle) };
}

//----------------------------------------------------------------------------------------------------------------------
