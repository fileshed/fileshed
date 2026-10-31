//----------------------------------------------------------------------------------------------------------------------
// Migration 010 — Event Timestamp Names
//
// The trashed, revoked and resolved timestamps and the deletion offer's expiry drop their _at suffix. No index or
// constraint is rebuilt: SQLite rewrites the CHECK constraints and indexes that name a renamed column, and Postgres
// tracks them by column, not by name.
//----------------------------------------------------------------------------------------------------------------------

import type { Kysely } from 'kysely';

//----------------------------------------------------------------------------------------------------------------------

// One column per statement: SQLite's ALTER TABLE takes a single alteration at a time.
async function renameColumn(db : Kysely<unknown>, table : string, from : string, to : string) : Promise<void>
{
    await db.schema
        .alterTable(table)
        .renameColumn(from, to)
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------

export async function up(db : Kysely<unknown>) : Promise<void>
{
    await renameColumn(db, 'node', 'trashed_at', 'trashed');
    await renameColumn(db, 'public_link', 'revoked_at', 'revoked');
    await renameColumn(db, 'share_request', 'resolved_at', 'resolved');
    await renameColumn(db, 'deletion_offer', 'expires_at', 'expires');
}

export async function down(db : Kysely<unknown>) : Promise<void>
{
    await renameColumn(db, 'node', 'trashed', 'trashed_at');
    await renameColumn(db, 'public_link', 'revoked', 'revoked_at');
    await renameColumn(db, 'share_request', 'resolved', 'resolved_at');
    await renameColumn(db, 'deletion_offer', 'expires', 'expires_at');
}

//----------------------------------------------------------------------------------------------------------------------
