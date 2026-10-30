//----------------------------------------------------------------------------------------------------------------------
// Migration 009 — Audit Timestamp Names
//
// The app tables' audit timestamps drop their _at suffix: created, updated, and the blob graveyard's deleted.
// better-auth's own tables keep the createdAt/updatedAt columns its migrator owns. Every row and value survives the
// rename; the blob graveyard index is rebuilt under the column's new name, since SQLite cannot rename an index.
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
    await db.schema.dropIndex('blob_deleted_at_idx').execute();

    await renameColumn(db, 'blob', 'created_at', 'created');
    await renameColumn(db, 'blob', 'deleted_at', 'deleted');
    await renameColumn(db, 'instance_setting', 'updated_at', 'updated');
    await renameColumn(db, 'node', 'created_at', 'created');
    await renameColumn(db, 'node', 'updated_at', 'updated');
    await renameColumn(db, 'share', 'created_at', 'created');
    await renameColumn(db, 'share_request', 'created_at', 'created');
    await renameColumn(db, 'public_link', 'created_at', 'created');
    await renameColumn(db, 'deletion_offer', 'created_at', 'created');

    await db.schema
        .createIndex('blob_deleted_idx')
        .on('blob')
        .column('deleted')
        .execute();
}

export async function down(db : Kysely<unknown>) : Promise<void>
{
    await db.schema.dropIndex('blob_deleted_idx').execute();

    await renameColumn(db, 'blob', 'created', 'created_at');
    await renameColumn(db, 'blob', 'deleted', 'deleted_at');
    await renameColumn(db, 'instance_setting', 'updated', 'updated_at');
    await renameColumn(db, 'node', 'created', 'created_at');
    await renameColumn(db, 'node', 'updated', 'updated_at');
    await renameColumn(db, 'share', 'created', 'created_at');
    await renameColumn(db, 'share_request', 'created', 'created_at');
    await renameColumn(db, 'public_link', 'created', 'created_at');
    await renameColumn(db, 'deletion_offer', 'created', 'created_at');

    await db.schema
        .createIndex('blob_deleted_at_idx')
        .on('blob')
        .column('deleted_at')
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------
