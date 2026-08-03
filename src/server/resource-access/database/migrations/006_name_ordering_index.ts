//----------------------------------------------------------------------------------------------------------------------
// Migration 006 — Name Ordering Index
//
// Name-ordered listings sort by lower(name) with the id tiebreak, an expression no plain column index can answer. The
// index stores the folded name and the tiebreak in that order, so the search listing -- the one whose ordering leads
// with the folded name -- reads its page straight off the index instead of sorting every match.
//
// The folder-first listings still sort, and are meant to: their leading key is the folder partition, which no index
// over the whole table can lead with. They reach their rows through the parent index and sort a single folder's
// worth, which is why this index does not try to cover them.
//----------------------------------------------------------------------------------------------------------------------

import { type Kysely, sql } from 'kysely';

//----------------------------------------------------------------------------------------------------------------------

export async function up(db : Kysely<unknown>) : Promise<void>
{
    await db.schema
        .createIndex('node_lower_name_idx')
        .on('node')
        .columns([ sql`lower(${ sql.ref('name') })`, 'id' ])
        .execute();
}

export async function down(db : Kysely<unknown>) : Promise<void>
{
    await db.schema
        .dropIndex('node_lower_name_idx')
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------
