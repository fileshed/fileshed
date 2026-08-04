//----------------------------------------------------------------------------------------------------------------------
// Database Factory & Row Schema
//
// Builds the Kysely instance for the deployment's chosen dialect and declares the row shapes of every table. These row
// types are a resource-access implementation detail -- the on-disk representation, snake_case and all -- and never
// enter @fileshed/core, which owns the canonical domain types. The row <-> domain transforms live alongside this file
// in the resource-access layer.
//
// Dual-dialect notes (Postgres is primary; SQLite is the convenience deployment):
//   - Timestamps: `timestamptz` on Postgres, ISO-8601 `text` on SQLite. pg hands back a Date, node:sqlite a string,
//     so a stored timestamp reads as `Date | string`; the row->domain transform normalizes with `new Date(...)`. Writes
//     are ISO strings, which both dialects accept.
//   - Booleans: `boolean` on Postgres, `integer` 0/1 on SQLite (node:sqlite binds only null, numbers, bigints, strings
//     and byte views). Selects read back as `boolean | number`; binds must be dialect-appropriate (true/false on
//     Postgres, 1/0 on SQLite).
//   - bigint columns (size, quota_limit): `bigint` on Postgres, `integer` on SQLite. The Postgres driver is configured
//     below to parse int8 as a JS number, so both dialects yield `number` (quota is a JS number; a
//     file exceeding 2^53 bytes is not a v1 concern).
//----------------------------------------------------------------------------------------------------------------------

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type ColumnType, Kysely, PostgresDialect } from 'kysely';
import { Pool, types as pgTypes } from 'pg';
import { NodeSqliteDialect } from '@fileshed/kysely-node-sqlite';

// Models
import { SQLITE_BUSY_TIMEOUT_MS, SQLITE_CACHE_SIZE } from '@fileshed/core';

// Utils
import type { Config } from '../../utils/config.ts';
import { getLogger } from '../../utils/logger.ts';
import { resolveDataPath } from '../../utils/paths.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('database');

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

    // BetterAuth's standard avatar-URL column. FileShed does not use it: avatars are content-addressed bytes in the
    // blob store, referenced by avatar_sha256 below, not a URL. Typed only because better-auth's migrator creates it.
    image : string | null;

    // role gates admin tooling; quota_limit is the per-user byte cap (null = unlimited). The role enum is enforced at
    // the codec and regulation layers. role is a nullable column upstream, but the admin plugin's create hook always
    // populates it, so the app treats it as set.
    role : 'admin' | 'user';
    quota_limit : number | null;

    // The admin plugin's ban flag, reason, and expiry (all null on accounts it has never banned), and better-auth's
    // account-creation stamp -- all emitted in camelCase like the rest of its base columns, so any hand-written SQL
    // must quote them. A dated ban past its expiry still carries banned = true until the user's next sign-in
    // attempt clears it; readers derive standing (see engines/ban.ts) instead of trusting the flag.
    banned : Bool | null;
    banReason : string | null;
    banExpires : Timestamp | null;
    createdAt : Timestamp;

    // The per-user preferences blob: JSON text, null when the account has set none. Written only by the app's own
    // preferences PATCH (see UserRA); read to assemble the /api/me profile.
    preferences : string | null;

    // The caller's avatar: the sha256 of its bytes in the shared blob store, and the stored mime the GET serves it
    // with (the blob record carries no mime -- an avatar has no node row to hang one on). Both null when unset. Better-
    // auth additionalFields (input:false); written only through the app's own avatar routes, never the auth API.
    avatar_sha256 : string | null;
    avatar_mime : string | null;
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

// An admin-set configuration override, layered above the loaded config. Secret values are stored encrypted.
export interface InstanceSettingTable
{
    key : string;
    value : string;
    updated_at : string;
}

// Embedded audio metadata keyed by content: deduplicated copies share one row, and the row's existence means
// extraction ran -- all-null is "carries no tags", not "not yet tried".
export interface MediaTagsTable
{
    blob_id : string;
    title : string | null;
    artist : string | null;
    album : string | null;
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
    message : string | null;
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

    // Owned by migration 002.
    media_tags : MediaTagsTable;

    // Owned by migration 003.
    instance_setting : InstanceSettingTable;
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
// numbers, so parse int8 to a number and match what SQLite already returns for INTEGER
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
// SQLite connection
//----------------------------------------------------------------------------------------------------------------------

// A `journal_mode` pragma reports the mode actually in force, which is how a refused WAL switch surfaces.
function isWalEnabled(result : unknown) : boolean
{
    if(!Array.isArray(result)) { return false; }

    const mode = (result[0] as { journal_mode ?: unknown } | undefined)?.journal_mode;

    return typeof mode === 'string' && mode.toLowerCase() === 'wal';
}

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

    // SQLite. `:memory:` is the in-memory sentinel (used by the specs) and has no parent directory to create; any
    // other path gets its directory ensured so a first run against ./data just works, and a relative one resolves
    // the way every data path does (utils/paths.ts).
    const databasePath = config.DATABASE_PATH === ':memory:'
        ? config.DATABASE_PATH
        : resolveDataPath(config.DATABASE_PATH);

    if(databasePath !== ':memory:')
    {
        mkdirSync(dirname(databasePath), { recursive: true });
    }

    // The handle is opened here rather than left to the dialect's own `location` config, because the WAL pragma below
    // has to be read back and acted on, not merely applied.
    const sqlite = new DatabaseSync(databasePath);

    // The FK actions (target_node_id / deletion_offer.sha256 cascades, RESTRICT on blobs) enforce real invariants, and
    // SQLite ignores foreign keys entirely unless this pragma is on for the connection. node:sqlite already opens with
    // them on; saying so explicitly keeps the deployment's behaviour a decision rather than an inherited default.
    sqlite.exec('PRAGMA foreign_keys = ON');

    // node:sqlite leaves both of these at SQLite's own defaults -- a busy timeout of 0, and a page cache an order of
    // magnitude smaller -- so these two lines are the only thing setting them. The timeout goes in before the WAL
    // switch below, which itself takes a brief exclusive lock and can come back busy on a contended file.
    sqlite.exec(`PRAGMA busy_timeout = ${ SQLITE_BUSY_TIMEOUT_MS }`);
    sqlite.exec(`PRAGMA cache_size = ${ SQLITE_CACHE_SIZE }`);

    // WAL keeps readers running through a write instead of blocking on it. The switch is a property of the file, not
    // the connection, and it can genuinely fail -- network filesystems do not support the shared memory WAL needs, and
    // SQLite reports that by returning the mode it kept rather than by throwing. A :memory: database never converts.
    if(databasePath !== ':memory:' && !isWalEnabled(sqlite.prepare('PRAGMA journal_mode = WAL').all()))
    {
        logger.warn({ databasePath }, 'SQLite stayed on its rollback journal; WAL is unavailable on this filesystem');
    }

    // WAL's companion: fsync at checkpoints rather than on every commit. A crash can cost the last transactions but
    // cannot corrupt the database. Reopening an existing WAL file lands here anyway; a freshly converted one does not.
    sqlite.exec('PRAGMA synchronous = NORMAL');

    const dialect = new NodeSqliteDialect({ database: sqlite });

    return { db: new Kysely<Database>({ dialect }), kind: 'sqlite' };
}

//----------------------------------------------------------------------------------------------------------------------
