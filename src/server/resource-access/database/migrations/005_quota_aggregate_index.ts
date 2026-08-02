//----------------------------------------------------------------------------------------------------------------------
// Migration 005 — Quota Aggregate Index
//
// A partial covering index for the per-owner quota charge, which runs on every upload admission and otherwise scans
// every file row the owner has. The predicate is a SQL literal rather than a bound parameter: an index predicate must
// be immutable, and a placeholder is rejected outright.
//
// Postgres matches a partial index only where it can prove the predicate while planning, which holds because the pg
// driver sends unnamed statements that are planned at Bind against real values. Anything that forces a generic plan --
// server-side prepared statements, plan_cache_mode, a pooler that promotes them -- puts the charge back on a heap scan.
//----------------------------------------------------------------------------------------------------------------------

import { type Kysely, sql } from 'kysely';

//----------------------------------------------------------------------------------------------------------------------

export async function up(db : Kysely<unknown>) : Promise<void>
{
    await db.schema
        .createIndex('node_owner_size_idx')
        .on('node')
        .columns([ 'owner_id', 'size' ])
        .where(sql.ref('type'), '=', sql.lit('file'))
        .execute();
}

export async function down(db : Kysely<unknown>) : Promise<void>
{
    await db.schema
        .dropIndex('node_owner_size_idx')
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------
