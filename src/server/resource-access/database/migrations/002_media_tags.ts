//----------------------------------------------------------------------------------------------------------------------
// Migration 002 — Media Tags
//
// Embedded audio metadata, keyed by CONTENT: the blob's sha256, not a node id, so deduplicated copies share one row
// and replacing a file's bytes naturally re-keys its tags. The row's existence means extraction RAN -- an all-null
// row is a file that carries no tags (or defeated the parser), and the backfill sweep will not retry it. The FK
// cascades with the blob row, so GC reaps tags alongside the content they describe.
//----------------------------------------------------------------------------------------------------------------------

import type { Kysely } from 'kysely';

//----------------------------------------------------------------------------------------------------------------------

export async function up(db : Kysely<unknown>) : Promise<void>
{
    await db.schema
        .createTable('media_tags')
        .addColumn('blob_id', 'text', (col) => col.primaryKey()
            .references('blob.sha256')
            .onDelete('cascade'))
        .addColumn('title', 'text')
        .addColumn('artist', 'text')
        .addColumn('album', 'text')
        .execute();
}

export async function down(db : Kysely<unknown>) : Promise<void>
{
    await db.schema.dropTable('media_tags').execute();
}

//----------------------------------------------------------------------------------------------------------------------
