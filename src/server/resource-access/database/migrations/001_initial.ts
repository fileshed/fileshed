//----------------------------------------------------------------------------------------------------------------------
// Initial Schema Migration — app tables
//
// The FileShed app tables, created in FK-dependency order and dropped in reverse. The
// BetterAuth identity tables (user/session/account/verification) are NOT touched here -- BetterAuth's own migrator
// owns them and runs first at boot, including the role (admin plugin) and quota_limit (additionalField) columns on
// user. The app tables carry real FKs to user.id.
//
// This migration is where the statically-expressible invariants live: the per-type node CHECK constraints, the real
// target_node_id and deletion_offer.sha256 ON DELETE CASCADE edges, and the paired share_request status/resolved_at
// constraint. Everything here is plain boolean SQL, valid on both dialects.
//----------------------------------------------------------------------------------------------------------------------

import { type Kysely, type RawBuilder, sql } from 'kysely';

// Models
import {
    nodeTypes,
    publicLinkDispositions,
    publicLinkModes,
    shareRequestStatuses,
    shareRoles,
    storageBackendKinds,
} from '@fileshed/core';

// Database
import type { DatabaseKind } from '../database.ts';

// Migrations
import { bigIntType, boolDefault, boolType, timestampType } from './columns.ts';

//----------------------------------------------------------------------------------------------------------------------

// Renders a domain vocabulary array as a SQL literal list, so the CHECK constraints and the domain share one source.
function inList(values : readonly string[]) : RawBuilder<unknown>
{
    return sql.join(values.map((value) => sql.lit(value)));
}

//----------------------------------------------------------------------------------------------------------------------

async function createIndex(
    db : Kysely<unknown>,
    name : string,
    table : string,
    columns : string[]
) : Promise<void>
{
    await db.schema
        .createIndex(name)
        .on(table)
        .columns(columns)
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------

async function dropTable(db : Kysely<unknown>, table : string) : Promise<void>
{
    await db.schema
        .dropTable(table)
        .ifExists()
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------

export async function up(db : Kysely<unknown>, kind : DatabaseKind) : Promise<void>
{
    const timestamp = timestampType(kind);
    const bool = boolType(kind);
    const bigInt = bigIntType(kind);

    //------------------------------------------------------------------------------------------------------------------
    // App tables
    //
    // The user table (and role, quota_limit) belongs entirely to BetterAuth's migrator: the admin plugin creates role,
    // and the quotaLimit additionalField (fieldName quota_limit, bigint) creates quota_limit. This migration only
    // references user.id via FKs; it never touches the user table itself.
    //------------------------------------------------------------------------------------------------------------------

    await db.schema
        .createTable('storage_backend')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('kind', 'text', (col) => col
            .notNull()
            .check(sql`kind in (${ inList(storageBackendKinds) })`))
        .addColumn('config', 'text', (col) => col.notNull())
        .addColumn('is_default', bool, (col) => col.notNull().defaultTo(boolDefault(kind, false)))
        .execute();

    // A blob pins its backend (records carry their storage location); RESTRICT so a backend still holding content
    // cannot be dropped out from under it. deleted_at is the GC graveyard marker.
    await db.schema
        .createTable('blob')
        .addColumn('sha256', 'text', (col) => col.primaryKey())
        .addColumn('size', bigInt, (col) => col.notNull().check(sql`size >= 0`))
        .addColumn('backend_id', 'text', (col) => col.notNull()
            .references('storage_backend.id')
            .onDelete('restrict'))
        .addColumn('storage_key', 'text', (col) => col.notNull())
        .addColumn('created_at', timestamp, (col) => col.notNull())
        .addColumn('deleted_at', timestamp)
        .execute();

    // node is the heart of the schema. owner_id and parent_id cascade so deleting a user or a folder takes its subtree
    // with it; blob_id RESTRICTs so a referenced blob cannot vanish; target_node_id CASCADEs so hard-deleting a target
    // removes every link to it, transactionally, across all trees. The per-type CHECK is the point of this migration --
    // see node_variant_fields_check below.
    await db.schema
        .createTable('node')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('type', 'text', (col) => col
            .notNull()
            .check(sql`type in (${ inList(nodeTypes) })`))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('owner_id', 'text', (col) => col.notNull()
            .references('user.id')
            .onDelete('cascade'))
        .addColumn('parent_id', 'text', (col) => col
            .references('node.id')
            .onDelete('cascade'))
        .addColumn('blob_id', 'text', (col) => col
            .references('blob.sha256')
            .onDelete('restrict'))
        .addColumn('target_node_id', 'text', (col) => col
            .references('node.id')
            .onDelete('cascade'))
        .addColumn('size', bigInt)
        .addColumn('mime_type', 'text')
        .addColumn('created_at', timestamp, (col) => col.notNull())
        .addColumn('updated_at', timestamp, (col) => col.notNull())
        .addColumn('trashed_at', timestamp)
        .addCheckConstraint('node_variant_fields_check', sql`
            (
                type = 'file'
                AND blob_id IS NOT NULL AND size IS NOT NULL AND size >= 0
                AND mime_type IS NOT NULL AND target_node_id IS NULL
            )
            OR (
                type = 'folder'
                AND blob_id IS NULL AND size IS NULL AND mime_type IS NULL AND target_node_id IS NULL
            )
            OR (
                type = 'link'
                AND target_node_id IS NOT NULL
                AND blob_id IS NULL AND size IS NULL AND mime_type IS NULL AND trashed_at IS NULL
            )
        `)
        .execute();

    // A grant is never for the owner -- owner authority is ownership, not a share row -- so role is viewer|editor only.
    // One grant per (node, grantee).
    await db.schema
        .createTable('share')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('node_id', 'text', (col) => col.notNull()
            .references('node.id')
            .onDelete('cascade'))
        .addColumn('grantee_user_id', 'text', (col) => col.notNull()
            .references('user.id')
            .onDelete('cascade'))
        .addColumn('role', 'text', (col) => col
            .notNull()
            .check(sql`role in (${ inList(shareRoles) })`))
        .addColumn('created_by', 'text', (col) => col.notNull().references('user.id'))
        .addColumn('created_at', timestamp, (col) => col.notNull())
        .addUniqueConstraint('share_node_grantee_unique', [ 'node_id', 'grantee_user_id' ])
        .execute();

    // resolved_at is set exactly when status leaves 'pending' -- the paired CHECK makes "pending with a resolution" and
    // "resolved without one" unrepresentable.
    await db.schema
        .createTable('share_request')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('node_id', 'text', (col) => col.notNull()
            .references('node.id')
            .onDelete('cascade'))
        .addColumn('requester_id', 'text', (col) => col.notNull()
            .references('user.id')
            .onDelete('cascade'))
        .addColumn('requested_role', 'text', (col) => col
            .notNull()
            .check(sql`requested_role in (${ inList(shareRoles) })`))
        .addColumn('status', 'text', (col) => col
            .notNull()
            .check(sql`status in (${ inList(shareRequestStatuses) })`))
        .addColumn('created_at', timestamp, (col) => col.notNull())
        .addColumn('resolved_at', timestamp)
        .addCheckConstraint('share_request_resolution_check', sql`(status = 'pending') = (resolved_at IS NULL)`)
        .execute();

    await db.schema
        .createTable('public_link')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('node_id', 'text', (col) => col.notNull()
            .references('node.id')
            .onDelete('cascade'))
        .addColumn('token', 'text', (col) => col.notNull().unique())
        .addColumn('mode', 'text', (col) => col
            .notNull()
            .check(sql`mode in (${ inList(publicLinkModes) })`))
        .addColumn('disposition', 'text', (col) => col
            .notNull()
            .check(sql`disposition in (${ inList(publicLinkDispositions) })`))
        .addColumn('created_at', timestamp, (col) => col.notNull())
        .addColumn('revoked_at', timestamp)
        .execute();

    // The offer's bytes ride the blob's GC grace window, so it CASCADEs off the blob: when GC hard-deletes the blob,
    // pending offers vanish with it. name/mime_type/size snapshot the deleted node.
    await db.schema
        .createTable('deletion_offer')
        .addColumn('id', 'text', (col) => col.primaryKey())
        .addColumn('sha256', 'text', (col) => col.notNull()
            .references('blob.sha256')
            .onDelete('cascade'))
        .addColumn('offeree_id', 'text', (col) => col.notNull()
            .references('user.id')
            .onDelete('cascade'))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('mime_type', 'text', (col) => col.notNull())
        .addColumn('size', bigInt, (col) => col.notNull().check(sql`size >= 0`))
        // CASCADE: a deleted user's outstanding offers void with them -- otherwise a pending offer to someone else
        // would block the user delete with an FK violation for up to the GC grace window.
        .addColumn('created_by', 'text', (col) => col.notNull().references('user.id')
            .onDelete('cascade'))
        .addColumn('created_at', timestamp, (col) => col.notNull())
        .addColumn('expires_at', timestamp, (col) => col.notNull())
        .execute();

    //------------------------------------------------------------------------------------------------------------------
    // Indexes
    //------------------------------------------------------------------------------------------------------------------

    await createIndex(db, 'blob_deleted_at_idx', 'blob', [ 'deleted_at' ]);
    await createIndex(db, 'node_parent_id_idx', 'node', [ 'parent_id' ]);
    await createIndex(db, 'node_owner_id_idx', 'node', [ 'owner_id' ]);
    await createIndex(db, 'node_blob_id_idx', 'node', [ 'blob_id' ]);
    await createIndex(db, 'node_target_node_id_idx', 'node', [ 'target_node_id' ]);
    await createIndex(db, 'share_grantee_user_id_idx', 'share', [ 'grantee_user_id' ]);
    await createIndex(db, 'share_request_node_status_idx', 'share_request', [ 'node_id', 'status' ]);
    await createIndex(db, 'public_link_node_id_idx', 'public_link', [ 'node_id' ]);
    await createIndex(db, 'deletion_offer_offeree_id_idx', 'deletion_offer', [ 'offeree_id' ]);
}

//----------------------------------------------------------------------------------------------------------------------

export async function down(db : Kysely<unknown>) : Promise<void>
{
    // App tables in reverse dependency order. Indexes drop with their tables, so only the tables are listed. The
    // BetterAuth-owned tables (user/session/account/verification) are never touched here -- BetterAuth owns them.
    await dropTable(db, 'deletion_offer');
    await dropTable(db, 'public_link');
    await dropTable(db, 'share_request');
    await dropTable(db, 'share');
    await dropTable(db, 'node');
    await dropTable(db, 'blob');
    await dropTable(db, 'storage_backend');
}

//----------------------------------------------------------------------------------------------------------------------
