//----------------------------------------------------------------------------------------------------------------------
// Test Database Reclamation
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { Client } from 'pg';

import { createId } from '@paralleldrive/cuid2';

// Utils
import type { Config } from '@server/utils/config.ts';

// Test support
import { testConfig } from '../auth/support.ts';
import { onAdmin, openTestDatabase, reclaimIfUnused, testDatabaseKind } from './database.ts';

//----------------------------------------------------------------------------------------------------------------------

function databaseNameOf(config : Config) : string
{
    return new URL(config.DATABASE_URL ?? '').pathname.slice(1);
}

async function exists(client : Client, database : string) : Promise<boolean>
{
    const found = await client.query('select 1 from pg_database where datname = $1', [ database ]);

    return found.rowCount === 1;
}

//----------------------------------------------------------------------------------------------------------------------

describe.runIf(testDatabaseKind() === 'postgres')('reclaimIfUnused', () =>
{
    it('drops a test database nothing is connected to', async () =>
    {
        const database = `fileshed_test_${ createId() }`;

        await onAdmin(async (client) =>
        {
            await client.query(`create database "${ database }"`);

            expect(await reclaimIfUnused(client, database)).toBe(true);
            expect(await exists(client, database)).toBe(false);
        });
    });

    it('leaves a database alone while a pool still holds a connection to it', async () =>
    {
        const { config, handle } = await openTestDatabase(testConfig());
        await sql`select 1`.execute(handle.db);

        await onAdmin(async (client) =>
        {
            const database = databaseNameOf(config);

            expect(await reclaimIfUnused(client, database)).toBe(false);
            expect(await exists(client, database)).toBe(true);
        });
    });
});

//----------------------------------------------------------------------------------------------------------------------
