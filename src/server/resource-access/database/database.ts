//----------------------------------------------------------------------------------------------------------------------
// Database Factory & Row Schema
//
// Builds the Kysely instance for the deployment's chosen dialect and declares the row shapes of every table. These row
// types are a resource-access implementation detail -- the on-disk representation, snake_case and all -- and never
// enter @fileshed/core, which owns the canonical domain types. The row <-> domain transforms live alongside this file
// in the resource-access layer.
//
// Dual-dialect notes (Postgres is primary; SQLite is the convenience deployment):
//   - Timestamps: `timestamptz` on Postgres, ISO-8601 `text` on SQLite. pg hands back a Date, better-sqlite3 a string,
//     so a stored timestamp reads as `Date | string`; the row->domain transform normalizes with `new Date(...)`. Writes
//     are ISO strings, which both dialects accept.
//   - Booleans: `boolean` on Postgres, `integer` 0/1 on SQLite (better-sqlite3 cannot bind a JS boolean). Selects read
//     back as `boolean | number`; binds must be dialect-appropriate (true/false on Postgres, 1/0 on SQLite).
//   - bigint columns (size, quota_limit): `bigint` on Postgres, `integer` on SQLite. The Postgres driver is configured
//     below to parse int8 as a JS number, so both dialects yield `number` (quota is a JS number; a
//     file exceeding 2^53 bytes is not a v1 concern).
//----------------------------------------------------------------------------------------------------------------------

import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ColumnType, Kysely, PostgresDialect, SqliteDialect } from 'kysely';
import { Pool, types as pgTypes } from 'pg';
import BetterSqlite3 from 'better-sqlite3';

// Utils
import type { Config } from '../../utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------
// Column helpers
//----------------------------------------------------------------------------------------------------------------------

// A stored timestamp. Written as an ISO-8601 string (portable across both dialects); read back as a Date on Postgres or
// a string on SQLite -- normalize at the row->domain boundary.
type Timestamp = ColumnType<Date | string, string, string>;

// A stored boolean. Reads back as a real boolean on Postgres, 0/1 on SQLite; binds must match the dialect (true/false
// vs 1/0), so both are accepted on write.
type Bool = ColumnType<boolean | number, boolean | number, boolean | number>;

//----------------------------------------------------------------------------------------------------------------------
// User (BetterAuth-owned identity)
//
// BetterAuth's own migrator creates and owns the entire user/session/account/verification set at boot -- including
// role (from the admin plugin) and quota_limit (from the quotaLimit additionalField). session/account/verification
// are purely BetterAuth's, so they are not typed here.
//
// Only the columns FileShed's app layer actually reads or writes are typed below, and only the ones whose names are
// stable snake_case: id/name/email (single-word), role, quota_limit and preferences (explicit snake_case fieldNames).
// BetterAuth emits its
// other base columns in camelCase regardless of the casing option (emailVerified, createdAt, updatedAt) -- deliberately
// left out here so this interface never lies about a column name. Whoever first needs one types it then, as it is.
//----------------------------------------------------------------------------------------------------------------------

export interface UserTable
{
    id : string;
    name : string;
    email : string;

    // BetterAuth's standard avatar URL, null when the account has none. Read for the owner-summary facet a listing
    // faces its owner filter with.
    image : string | null;

    // role gates admin tooling; quota_limit is the per-user byte cap (null = unlimited). The role enum is enforced at
    // the codec and regulation layers. role is a nullable column upstream, but the admin plugin's create hook always
    // populates it, so the app treats it as set.
    role : 'admin' | 'user';
    quota_limit : number | null;

    // The per-user preferences blob: JSON text, null when the account has set none. Written only by the app's own
    // preferences PATCH (see UserRA); read to assemble the /api/me profile.
    preferences : string | null;
}

//----------------------------------------------------------------------------------------------------------------------
// App tables
//----------------------------------------------------------------------------------------------------------------------

export interface StorageBackendTable
{
    id : string;
    kind : 'fs' | 'db' | 's3' | 'azure';
    config : string;
    is_default : Bool;
}

export interface BlobTable
{
    sha256 : string;
    size : number;
    backend_id : string;
    storage_key : string;
    created_at : Timestamp;
    deleted_at : Timestamp | null;
}

export interface NodeTable
{
    id : string;
    type : 'file' | 'folder' | 'link';
    name : string;
    owner_id : string;
    parent_id : string | null;
    blob_id : string | null;
    target_node_id : string | null;
    size : number | null;
    mime_type : string | null;
    created_at : Timestamp;
    updated_at : Timestamp;
    trashed_at : Timestamp | null;
}

export interface ShareTable
{
    id : string;
    node_id : string;
    grantee_user_id : string;
    role : 'viewer' | 'editor';
    created_by : string;
    created_at : Timestamp;
}

export interface ShareRequestTable
{
    id : string;
    node_id : string;
    requester_id : string;
    requested_role : 'viewer' | 'editor';
    status : 'pending' | 'granted' | 'declined';
    created_at : Timestamp;
    resolved_at : Timestamp | null;
}

export interface PublicLinkTable
{
    id : string;
    node_id : string;
    token : string;
    mode : 'view' | 'download';
    disposition : 'inline' | 'attachment';
    created_at : Timestamp;
    revoked_at : Timestamp | null;
}

export interface DeletionOfferTable
{
    id : string;
    sha256 : string;
    offeree_id : string;
    name : string;
    mime_type : string;
    size : number;
    created_by : string;
    created_at : Timestamp;
    expires_at : Timestamp;
}

//----------------------------------------------------------------------------------------------------------------------
// Schema
//----------------------------------------------------------------------------------------------------------------------

export interface Database
{
    // Owned by BetterAuth's migrator; typed here because the app extends and reads it (see UserTable).
    user : UserTable;

    // Owned by migration 001.
    storage_backend : StorageBackendTable;
    blob : BlobTable;
    node : NodeTable;
    share : ShareTable;
    share_request : ShareRequestTable;
    public_link : PublicLinkTable;
    deletion_offer : DeletionOfferTable;
}

// The dialect discriminator. A subset of BetterAuth's KyselyDatabaseType, so it drops straight into the
// `database: { db, type }` wiring.
export type DatabaseKind = Config['DATABASE_KIND'];

export interface DatabaseHandle
{
    db : Kysely<Database>;
    kind : DatabaseKind;
}

//----------------------------------------------------------------------------------------------------------------------
// Postgres type parsing
//----------------------------------------------------------------------------------------------------------------------

// node-postgres returns int8 (bigint) as a string to avoid precision loss. FileShed treats sizes and quotas as JS
// numbers, so parse int8 to a number and match what better-sqlite3 already returns for INTEGER
// columns. Scoped to this pool's `types` option rather than pg's global parser table, and left narrow -- timestamptz
// and boolean keep their native pg parsing so the shared BetterAuth connection reads Dates and booleans as it expects.
const INT8_OID = 20;

// pg never invokes a type parser for a SQL NULL (it short-circuits to null), so this only ever sees a numeric string.
function parseInt8(value : string) : number
{
    return Number(value);
}

function postgresTypeParser(oid : number) : ReturnType<typeof pgTypes.getTypeParser>
{
    return oid === INT8_OID ? parseInt8 : pgTypes.getTypeParser(oid);
}

const postgresTypes = { getTypeParser: postgresTypeParser };

//----------------------------------------------------------------------------------------------------------------------

export function createDatabase(config : Config) : DatabaseHandle
{
    if(config.DATABASE_KIND === 'postgres')
    {
        if(!config.DATABASE_URL)
        {
            throw new Error('DATABASE_URL is required when DATABASE_KIND=postgres');
        }

        const dialect = new PostgresDialect({
            pool: new Pool({ connectionString: config.DATABASE_URL, types: postgresTypes }),
        });

        return { db: new Kysely<Database>({ dialect }), kind: 'postgres' };
    }

    // SQLite. `:memory:` is better-sqlite3's in-memory sentinel (used by the specs) and has no parent directory to
    // create; any other path gets its directory ensured so a first run against ./data just works. Relative paths
    // resolve against the REPO ROOT, not process.cwd() -- the Vite dev server runs with src/client as its cwd while
    // the standalone entry runs at the root, and cwd-relative resolution silently split them across two database
    // files. This file sits four directories below the root.
    const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
    const databasePath = config.DATABASE_PATH === ':memory:' || isAbsolute(config.DATABASE_PATH)
        ? config.DATABASE_PATH
        : resolve(repoRoot, config.DATABASE_PATH);

    if(databasePath !== ':memory:')
    {
        mkdirSync(dirname(databasePath), { recursive: true });
    }

    const sqlite = new BetterSqlite3(databasePath);

    // The FK actions (target_node_id / deletion_offer.sha256 cascades, RESTRICT on blobs) enforce real invariants, and
    // SQLite ignores foreign keys entirely unless this pragma is on for the connection.
    sqlite.pragma('foreign_keys = ON');

    const dialect = new SqliteDialect({ database: sqlite });

    return { db: new Kysely<Database>({ dialect }), kind: 'sqlite' };
}

//----------------------------------------------------------------------------------------------------------------------
