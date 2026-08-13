//----------------------------------------------------------------------------------------------------------------------
// Blob Resource Access
//
// The one blob surface every manager consumes: the `blob` table's records and the bytes those records pin, behind a
// single RA, with storage backends (fs now; db/s3/azure later) as lazily-built facades no layer above ever names.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- insert values and update sets name snake_case DB columns (house convention) */

import type { Readable } from 'node:stream';

import { sql } from 'kysely';

// Models
import {
    BackendNotFoundError,
    NoDefaultBackendError,
    type StorageBackendKind,
    UnsupportedBackendError,
    storageBackendKinds,
} from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';
import { type BlobBackend, type BlobRange } from '../interfaces/blob.ts';
import { FsBackend, parseFsBackendConfig } from './fsBackend.ts';

// The blob error vocabulary and the backend contract, re-exported here so a consumer branches on a failure or types a
// backend without a second import from core.
export {
    BackendNotFoundError,
    BlobBackendError,
    BlobNotFoundError,
    HashMismatchError,
    InvalidSha256Error,
    NoDefaultBackendError,
    SizeMismatchError,
    UnsupportedBackendError,
} from '@fileshed/core';
export type { BlobBackend } from '../interfaces/blob.ts';

//----------------------------------------------------------------------------------------------------------------------
// Types
//----------------------------------------------------------------------------------------------------------------------

// Where a blob's bytes live: the backend that holds them and the key within it. For the fs backend the key is the
// sha256 (the backend derives its sharded path from it); other backends may key differently, hence the explicit pin.
export interface BlobLocation
{
    backendID : string;
    storageKey : string;
}

// The fields needed to write a blob record; created_at and the (cleared) deleted_at are set by the write itself.
export interface BlobRowInsert
{
    sha256 : string;
    size : number;
    backendID : string;
    storageKey : string;
}

// A stored blob record as the flow reads it back. deletedAt is the GC graveyard marker: null means live.
export interface BlobRow
{
    sha256 : string;
    size : number;
    backendID : string;
    storageKey : string;
    deletedAt : Date | null;
}

// Enough of a graveyarded record for GC to delete its bytes and route to the right backend (records pin their
// backend), plus the size it reclaims by doing so -- read here because the row is gone by the time the bytes go.
export interface GcCandidate
{
    sha256 : string;
    size : number;
    backendID : string;
    storageKey : string;
}

// A configured backend as the admin status readout names it: identity, kind, and default flag -- never the config
// blob, which can hold credentials.
export interface BackendListing
{
    id : string;
    kind : StorageBackendKind;
    isDefault : boolean;
}

//----------------------------------------------------------------------------------------------------------------------

// A stored timestamp reads back as a Date (Postgres) or an ISO string (SQLite); new Date normalizes both (database.ts).
function toNullableDate(value : Date | string | null) : Date | null
{
    return value === null ? null : new Date(value);
}

// Narrows the storage_backend.kind text column to the domain enum. The column is app-written, so an unknown value is
// corruption, not an expected input -- listBackends refuses it rather than widening the status readout's kind.
function isStorageBackendKind(value : string) : value is StorageBackendKind
{
    return (storageBackendKinds as readonly string[]).includes(value);
}

//----------------------------------------------------------------------------------------------------------------------

export class BlobRA
{
    readonly #db : DatabaseHandle['db'];
    readonly #kind : DatabaseHandle['kind'];
    readonly #facades = new Map<string, BlobBackend>();
    #defaultBackendID : string | undefined;

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
        this.#kind = handle.kind;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Bytes
    //------------------------------------------------------------------------------------------------------------------

    // Stream bytes onto the default backend, which verifies them against the claimed sha256 and size while writing.
    // Returns the pin the blob record stores; the key is the sha256, content-addressed.
    async put(sha256 : string, stream : Readable, size : number) : Promise<BlobLocation>
    {
        const backendID = await this.#defaultBackend();
        const backend = await this.#facade(backendID);

        await backend.put(sha256, stream, size);

        return { backendID, storageKey: sha256 };
    }

    // Read exactly one window for a proof-of-possession challenge, routed to the record's own backend.
    async read(location : BlobLocation, offset : number, length : number) : Promise<Buffer>
    {
        return (await this.#facade(location.backendID)).read(location.storageKey, offset, length);
    }

    async getStream(location : BlobLocation, range ?: BlobRange) : Promise<Readable>
    {
        return (await this.#facade(location.backendID)).getStream(location.storageKey, range);
    }

    async delete(location : BlobLocation) : Promise<void>
    {
        await (await this.#facade(location.backendID)).delete(location.storageKey);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Chunked uploads
    //
    // A file arriving as a sequence of requests stages on the default backend and is published there, so the pin a
    // finished chunked upload returns is the same one a single-stream put would have.
    //------------------------------------------------------------------------------------------------------------------

    async appendChunk(uploadID : string, stream : Readable, offset : number) : Promise<number>
    {
        const backend = await this.#facade(await this.#defaultBackend());

        return backend.appendChunk(uploadID, stream, offset);
    }

    // Verify the staged bytes against the claim and publish them, answering the pin the blob record stores.
    async commitChunked(uploadID : string, sha256 : string, size : number) : Promise<BlobLocation>
    {
        const backendID = await this.#defaultBackend();
        const backend = await this.#facade(backendID);

        await backend.commitChunked(uploadID, sha256, size);

        return { backendID, storageKey: sha256 };
    }

    async discardChunked(uploadID : string) : Promise<void>
    {
        const backend = await this.#facade(await this.#defaultBackend());

        await backend.discardChunked(uploadID);
    }

    async sweepChunked(cutoff : Date) : Promise<number>
    {
        const backend = await this.#facade(await this.#defaultBackend());

        return backend.sweepChunked(cutoff);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Row reads
    //------------------------------------------------------------------------------------------------------------------

    // The record for a sha256, graveyarded or not -- the claim path reads this to tell an unknown blob (mint a ticket)
    // from a known one (challenge or resurrect). A graveyarded record is still "known".
    async get(sha256 : string) : Promise<BlobRow | undefined>
    {
        const row = await this.#db
            .selectFrom('blob')
            .select([ 'sha256', 'size', 'backend_id', 'storage_key', 'deleted_at' ])
            .where('sha256', '=', sha256)
            .executeTakeFirst();

        if(row === undefined) { return undefined; }

        return {
            sha256: row.sha256,
            size: row.size,
            backendID: row.backend_id,
            storageKey: row.storage_key,
            deletedAt: toNullableDate(row.deleted_at),
        };
    }

    // The records eligible for hard deletion: graveyarded and past the grace cutoff. deleted_at is written as
    // an ISO string on both dialects, so the comparison is against the cutoff's ISO form; a null deleted_at never
    // satisfies `< cutoff`, so live records are excluded without a separate guard.
    async gcCandidates(cutoff : Date) : Promise<GcCandidate[]>
    {
        const rows = await this.#db
            .selectFrom('blob')
            .select([ 'sha256', 'size', 'backend_id', 'storage_key' ])
            .where('deleted_at', '<', cutoff.toISOString())
            .execute();

        return rows.map((row) => ({
            sha256: row.sha256,
            size: row.size,
            backendID: row.backend_id,
            storageKey: row.storage_key,
        }));
    }

    // The configured backends for the admin status readout: id, kind, and default flag only. The config column is
    // deliberately never selected -- it can hold backend credentials that no status view should surface. is_default
    // reads back as 1/0 on SQLite and a boolean on Postgres, normalized to a boolean here.
    async listBackends() : Promise<BackendListing[]>
    {
        const rows = await this.#db
            .selectFrom('storage_backend')
            .select([ 'id', 'kind', 'is_default' ])
            .execute();

        return rows.map((row) =>
        {
            if(!isStorageBackendKind(row.kind))
            {
                throw new Error(`storage backend ${ row.id } has an unknown kind ${ row.kind }`);
            }

            return { id: row.id, kind: row.kind, isDefault: Boolean(row.is_default) };
        });
    }

    // Live bytes are the deduplicated footprint actually on disk -- every live record, including the avatar and
    // branding blobs no file node references. The graveyarded pair is what a GC sweep stands to reclaim once each
    // record's grace window closes.
    async storageTotals() : Promise<{ liveBytes : number; graveyardBytes : number; graveyardCount : number }>
    {
        const row = await this.#db
            .selectFrom('blob')
            .select([
                sql<string | number>`coalesce(sum(case when deleted_at is null then size else 0 end), 0)`
                    .as('live_bytes'),
                sql<string | number>`coalesce(sum(case when deleted_at is null then 0 else size end), 0)`
                    .as('graveyard_bytes'),
                sql<string | number>`coalesce(sum(case when deleted_at is null then 0 else 1 end), 0)`
                    .as('graveyard_count'),
            ])
            .executeTakeFirstOrThrow();

        return {
            liveBytes: Number(row.live_bytes),
            graveyardBytes: Number(row.graveyard_bytes),
            graveyardCount: Number(row.graveyard_count),
        };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Row writes
    //------------------------------------------------------------------------------------------------------------------

    // Insert the record, or if it already exists, clear its graveyard marker (resurrection). One race-safe
    // statement: two writers committing the same new blob concurrently both succeed, and a graveyarded record comes
    // back to life. The conflict path only touches deleted_at -- backend_id/storage_key are never clobbered, since the
    // existing bytes already live wherever the record says they do. Run inside the same transaction as the node insert
    // so the reference and the resurrection commit together.
    async insertOrResurrect(blob : BlobRowInsert) : Promise<void>
    {
        await this.#db
            .insertInto('blob')
            .values({
                sha256: blob.sha256,
                size: blob.size,
                backend_id: blob.backendID,
                storage_key: blob.storageKey,
                created_at: new Date().toISOString(),
                deleted_at: null,
            })
            .onConflict((oc) => oc.column('sha256').doUpdateSet({ deleted_at: null }))
            .execute();
    }

    // Clear the graveyard marker on an existing record (resurrection) without touching anything else. Updates
    // nothing when the sha256 is absent -- a record GC already hard-deleted cannot be resurrected, and the caller's
    // node insert then fails the blob_id FK, which is the correct outcome.
    async resurrect(sha256 : string) : Promise<void>
    {
        await this.#db
            .updateTable('blob')
            .set({ deleted_at: null })
            .where('sha256', '=', sha256)
            .execute();
    }

    // Graveyard every listed sha256 whose last reference is gone (ref count is derived, never a stored counter). A blob
    // is referenced by any file node pointing at it OR by any user whose avatar it is -- both keep it live, so both are
    // checked. One statement, so a concurrent claim that adds a reference either lands before this -- a NOT EXISTS then
    // sees it and the record is left live -- or after, on an already-graveyarded record it resurrects. The
    // `deleted_at IS NULL` guard keeps a re-sweep from resetting an already-graveyarded record's grace clock. Accepts
    // an executor so a caller can run this in the same transaction as the delete that orphaned the blobs (the node
    // manager's hard delete, an avatar replace); defaults to the handle's connection.
    async graveyardUnreferenced(shas : string[], executor : DatabaseHandle['db'] = this.#db) : Promise<void>
    {
        if(shas.length === 0) { return; }

        await executor
            .updateTable('blob')
            .set({ deleted_at: new Date().toISOString() })
            .where('sha256', 'in', shas)
            .where('deleted_at', 'is', null)
            .where((eb) => eb.not(eb.exists(
                eb.selectFrom('node')
                    .select('node.id')
                    .whereRef('node.blob_id', '=', 'blob.sha256')
                    .where('node.type', '=', 'file')
            )))
            .where((eb) => eb.not(eb.exists(
                eb.selectFrom('user')
                    .select('user.id')
                    .whereRef('user.avatar_sha256', '=', 'blob.sha256')
            )))
            // The instance logo's reference row stores the hash JSON-encoded (the settings store quotes every
            // value), so the comparison wraps the candidate hash in literal quotes.
            .where((eb) => eb.not(eb.exists(
                eb.selectFrom('instance_setting')
                    .select('instance_setting.key')
                    .where('instance_setting.key', '=', 'BRANDING_LOGO_SHA')
                    .where(sql<boolean>`instance_setting.value = '"' || blob.sha256 || '"'`)
            )))
            .execute();
    }

    // Hard-delete one record, but only if it is still graveyarded past the cutoff at delete time. The
    // re-checked predicate is the GC half of the concurrency rule: a claim that resurrected the record (deleted_at
    // cleared) between candidacy and here no longer matches, so GC removes nothing and the resurrected blob survives.
    // Returns whether a row was actually removed, so the caller only deletes the bytes when the record is truly gone.
    async hardDeleteRow(sha256 : string, cutoff : Date) : Promise<boolean>
    {
        const result = await this.#db
            .deleteFrom('blob')
            .where('sha256', '=', sha256)
            .where('deleted_at', '<', cutoff.toISOString())
            .executeTakeFirst();

        return Number(result?.numDeletedRows ?? 0) > 0;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Backend resolution
    //
    // Facades are built lazily from their storage_backend row and cached per backend id. An fs row becomes an
    // FsBackend; any other kind is a typed UnsupportedBackendError, not a placeholder -- the schema admits db/s3/azure,
    // but v1 ships fs only (remaining backends are later work).
    //------------------------------------------------------------------------------------------------------------------

    async #facade(backendID : string) : Promise<BlobBackend>
    {
        const cached = this.#facades.get(backendID);
        if(cached !== undefined) { return cached; }

        const row = await this.#db
            .selectFrom('storage_backend')
            .select([ 'kind', 'config' ])
            .where('id', '=', backendID)
            .executeTakeFirst();

        if(row === undefined) { throw new BackendNotFoundError(backendID); }

        const facade = this.#build(row.kind, row.config);
        this.#facades.set(backendID, facade);
        return facade;
    }

    async #defaultBackend() : Promise<string>
    {
        if(this.#defaultBackendID !== undefined) { return this.#defaultBackendID; }

        const row = await this.#db
            .selectFrom('storage_backend')
            .select('id')
            .where('is_default', '=', this.#kind === 'postgres' ? true : 1)
            .executeTakeFirst();

        if(row === undefined) { throw new NoDefaultBackendError(); }

        this.#defaultBackendID = row.id;
        return row.id;
    }

    #build(kind : string, config : string) : BlobBackend
    {
        switch (kind)
        {
            case 'fs':
                return new FsBackend(parseFsBackendConfig(JSON.parse(config)));

            default:
                throw new UnsupportedBackendError(kind);
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
