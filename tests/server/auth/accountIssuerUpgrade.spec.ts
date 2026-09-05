//----------------------------------------------------------------------------------------------------------------------
// Upgrading a database whose accounts predate the issuer key
//
// The unit spec beside the backfill proves the values it writes. This proves the thing an operator actually cares
// about: a database carrying accounts from before better-auth keyed them on (issuer, accountId) boots, all the way
// through better-auth's own migrator -- which is where the upgrade would otherwise stop, because that migrator will
// not add a required column with no default to a table that already has rows, and then builds a unique index over
// exactly the values the backfill wrote.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

import { type Kysely, sql } from 'kysely';

// Resource Access
import { initialize } from '@server/resource-access/boot.ts';
import { createAuth } from '@server/resource-access/auth.ts';
import type { Database, DatabaseHandle } from '@server/resource-access/database/database.ts';

// Test support
import { TEST_AUTH_SECRET, testConfig } from './support.ts';
import { openTestDatabase } from '../support/database.ts';

//----------------------------------------------------------------------------------------------------------------------

const handles : DatabaseHandle[] = [];

afterEach(async () =>
{
    await Promise.all(handles.splice(0).map((handle) => handle.db.destroy()));
});

// The user and account tables as better-auth wrote them before the issuer key, carrying one of each kind of sign-in.
async function seedPreIssuerIdentity(db : Kysely<Database>) : Promise<void>
{
    const now = new Date().toISOString();

    await sql`
        create table "user" (
            id text primary key,
            name text not null,
            email text not null unique,
            "emailVerified" integer not null default 0,
            image text,
            role text,
            banned integer,
            "banReason" text,
            "banExpires" text,
            quota_limit integer,
            preferences text,
            "createdAt" text not null,
            "updatedAt" text not null
        )
    `.execute(db);

    await sql`
        create table account (
            id text primary key,
            "accountId" text not null,
            "providerId" text not null,
            "userId" text not null,
            "accessToken" text,
            "refreshToken" text,
            "idToken" text,
            "accessTokenExpiresAt" text,
            "refreshTokenExpiresAt" text,
            scope text,
            password text,
            "createdAt" text not null,
            "updatedAt" text not null
        )
    `.execute(db);

    await sql`
        insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        values ('u1', 'Owner', 'owner@example.com', 1, ${ now }, ${ now })
    `.execute(db);

    await sql`
        insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        values ('a1', 'owner@example.com', 'credential', 'u1', 'hashed', ${ now }, ${ now }),
               ('a2', '4021', 'github', 'u1', null, ${ now }, ${ now })
    `.execute(db);
}

//----------------------------------------------------------------------------------------------------------------------

describe('booting over accounts written before the issuer key', () =>
{
    it('completes the migrations and keeps every account, each under its own issuer', async () =>
    {
        const { config, handle } = await openTestDatabase(testConfig());
        handles.push(handle);
        await seedPreIssuerIdentity(handle.db);

        await initialize(handle, createAuth(handle, config, TEST_AUTH_SECRET));

        const { rows } = await sql<{ id : string; issuer : string }>`
            select id, issuer from account order by id
        `.execute(handle.db);

        expect(rows).toEqual([
            { id: 'a1', issuer: 'local:credential' },
            { id: 'a2', issuer: 'local:oauth:github' },
        ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
