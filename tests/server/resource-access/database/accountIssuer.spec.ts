//----------------------------------------------------------------------------------------------------------------------
// Account Issuer Backfill — bringing a pre-1.7 identity table forward
//
// The contract: a database whose account table predates the (issuer, accountId) key gains the column, filled with the
// synthetic namespace better-auth uses for a provider whose real authority was never recorded -- `local:credential`
// for email and password, `local:oauth:<provider>` for everything else. A database that already has the column, and
// one with no account table at all, are left exactly as they are. Two rows that would land on the same identity are
// named rather than left for the unique index to refuse.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Kysely, sql } from 'kysely';

// Resource Access
import { backfillAccountIssuer } from '@server/resource-access/database/accountIssuer.ts';
import {
    type Database,
    type DatabaseHandle,
    createDatabase,
} from '@server/resource-access/database/database.ts';

// Utils
import type { Config } from '@server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

const config = { DATABASE_KIND: 'sqlite', DATABASE_PATH: ':memory:' } as Config;

let handle : DatabaseHandle;

// The account table as better-auth wrote it before the issuer key existed: camelCase columns, no issuer.
async function createLegacyAccountTable(db : Kysely<Database>) : Promise<void>
{
    await sql`
        create table account (
            id text primary key,
            "accountId" text not null,
            "providerId" text not null,
            "userId" text not null,
            scope text,
            password text,
            "createdAt" text not null,
            "updatedAt" text not null
        )
    `.execute(db);
}

async function insertAccount(db : Kysely<Database>, id : string, providerId : string, accountId : string)
: Promise<void>
{
    const now = new Date().toISOString();

    await sql`
        insert into account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt")
        values (${ id }, ${ accountId }, ${ providerId }, ${ `u-${ id }` }, ${ now }, ${ now })
    `.execute(db);
}

async function issuersByID(db : Kysely<Database>) : Promise<Record<string, string | null>>
{
    const { rows } = await sql<{ id : string; issuer : string | null }>`select id, issuer from account`.execute(db);

    return Object.fromEntries(rows.map((row) => [ row.id, row.issuer ]));
}

beforeEach(() => { handle = createDatabase(config); });
afterEach(async () => { await handle.db.destroy(); });

//----------------------------------------------------------------------------------------------------------------------

describe('backfillAccountIssuer', () =>
{
    it('gives an email-and-password account the local credential issuer', async () =>
    {
        await createLegacyAccountTable(handle.db);
        await insertAccount(handle.db, 'a1', 'credential', 'user@example.com');

        await backfillAccountIssuer(handle);

        expect(await issuersByID(handle.db)).toEqual({ a1: 'local:credential' });
    });

    // A row written before the key existed says which connection was configured, never which authority verified the
    // identity, so every provider gets the synthetic namespace rather than a real issuer URL.
    it('gives each social account the synthetic namespace for its provider', async () =>
    {
        await createLegacyAccountTable(handle.db);
        await insertAccount(handle.db, 'a1', 'github', '4021');
        await insertAccount(handle.db, 'a2', 'google', '11778');

        await backfillAccountIssuer(handle);

        expect(await issuersByID(handle.db)).toEqual({
            a1: 'local:oauth:github',
            a2: 'local:oauth:google',
        });
    });

    it('leaves a table that already carries the column untouched', async () =>
    {
        await createLegacyAccountTable(handle.db);
        await insertAccount(handle.db, 'a1', 'github', '4021');
        await backfillAccountIssuer(handle);

        await sql`update account set issuer = 'https://github.com'`.execute(handle.db);
        await backfillAccountIssuer(handle);

        expect(await issuersByID(handle.db)).toEqual({ a1: 'https://github.com' });
    });

    // A first boot: better-auth has not created the identity tables yet, and creating one here would be inventing a
    // schema it owns.
    it('does nothing when there is no account table at all', async () =>
    {
        await expect(backfillAccountIssuer(handle)).resolves.toBeUndefined();
    });

    // The pair becomes a unique key as soon as better-auth's migrator runs. Naming the rows beats an index that will
    // not build for reasons the operator has to guess at.
    it('refuses, naming the identity, when two accounts would become the same one', async () =>
    {
        await createLegacyAccountTable(handle.db);
        await insertAccount(handle.db, 'a1', 'github', '4021');
        await insertAccount(handle.db, 'a2', 'github', '4021');

        await expect(backfillAccountIssuer(handle)).rejects.toThrow(/local:oauth:github \/ 4021/u);
    });
});

//----------------------------------------------------------------------------------------------------------------------
