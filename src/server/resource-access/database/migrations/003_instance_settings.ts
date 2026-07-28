//----------------------------------------------------------------------------------------------------------------------
// Migration 003 — Instance Settings
//
// Admin-set configuration overrides, one row per key, layered above the loaded config at runtime. Values are JSON
// text; secret values are stored encrypted (utils/secretBox). updated_at is per-key so the admin UI can show what
// changed and the status surface can tell whether a requiresRestart key moved since boot.
//----------------------------------------------------------------------------------------------------------------------

import type { Kysely } from 'kysely';

//----------------------------------------------------------------------------------------------------------------------

export async function up(db : Kysely<unknown>) : Promise<void>
{
    await db.schema
        .createTable('instance_setting')
        .addColumn('key', 'text', (col) => col.primaryKey())
        .addColumn('value', 'text', (col) => col.notNull())
        .addColumn('updated_at', 'text', (col) => col.notNull())
        .execute();
}

export async function down(db : Kysely<unknown>) : Promise<void>
{
    await db.schema.dropTable('instance_setting').execute();
}

//----------------------------------------------------------------------------------------------------------------------
