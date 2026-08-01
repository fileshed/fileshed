//----------------------------------------------------------------------------------------------------------------------
// Migration 004 — Quota Zero Semantics
//
// quota_limit = 0 used to be a block-all cap; it now reads as "explicitly unlimited". Rows still carrying the old
// value become a one-byte cap, so an operator's deny stays a deny instead of quietly turning into the storage grant
// they refused. The remap is lossy in one direction only, so there is no down().
//----------------------------------------------------------------------------------------------------------------------

import { type Kysely, sql } from 'kysely';

//----------------------------------------------------------------------------------------------------------------------

export async function up(db : Kysely<unknown>) : Promise<void>
{
    await sql`update "user" set quota_limit = 1 where quota_limit = 0`.execute(db);
}

//----------------------------------------------------------------------------------------------------------------------
