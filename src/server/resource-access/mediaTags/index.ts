//----------------------------------------------------------------------------------------------------------------------
// Media Tags Resource Access
//
// The media_tags rows and the parse that fills them. Tags are facts about CONTENT, keyed by blob sha256: dedup'd
// copies share one row, replacing a file's bytes re-keys naturally, and GC's cascade reaps tags with their blob.
// A row's existence means extraction RAN -- all-null is "carries no tags" (or defeated the parser), never "not yet
// tried" -- which is what lets the backfill sweep terminate instead of chewing the same untagged files forever.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- inserts name snake_case DB columns (house convention for Kysely) */

import type { Readable } from 'node:stream';

import { sql } from 'kysely';
import { parseStream } from 'music-metadata';

// Models
import { MEDIA_TAG_MAX_LENGTH } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface ExtractedTags
{
    title : string | null;
    artist : string | null;
    album : string | null;
}

export interface UntaggedBlob
{
    blobID : string;
    mimeType : string;
}

//----------------------------------------------------------------------------------------------------------------------

// A tag frame carries whatever the tagger wrote, and these rows ride into search responses, so what is stored is the
// front of a tag rather than all of one.
function capped(value : string | undefined) : string | null
{
    if(value === undefined) { return null; }

    return value.slice(0, MEDIA_TAG_MAX_LENGTH);
}

// Pull the three searchable tags out of an audio stream. The parser SNIFFS the container rather than trusting a
// declared mime -- stored mimes lie (the playlists lesson), and music-metadata's mime-hinted stream path also
// trips over inputs its sniffer handles fine. Any parse failure -- truncated file, exotic container -- reads as no
// tags rather than an error: extraction is best-effort enrichment, never a gate on the upload that triggered it.
// The stream is destroyed either way; parsing stops once the metadata ends, and an abandoned blob stream would
// otherwise hold its backend handle open.
export async function extractTags(stream : Readable) : Promise<ExtractedTags>
{
    try
    {
        const parsed = await parseStream(stream, {}, { duration: false, skipCovers: true });

        return {
            title: capped(parsed.common.title),
            artist: capped(parsed.common.artist),
            album: capped(parsed.common.album),
        };
    }
    catch
    {
        return { title: null, artist: null, album: null };
    }
    finally
    {
        stream.destroy();
    }
}

//----------------------------------------------------------------------------------------------------------------------

export class MediaTagsRA
{
    readonly #db : DatabaseHandle['db'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
    }

    async get(blobID : string) : Promise<ExtractedTags | undefined>
    {
        const row = await this.#db
            .selectFrom('media_tags')
            .select([ 'title', 'artist', 'album' ])
            .where('blob_id', '=', blobID)
            .executeTakeFirst();

        return row === undefined ? undefined : { title: row.title, artist: row.artist, album: row.album };
    }

    async upsert(blobID : string, tags : ExtractedTags) : Promise<void>
    {
        await this.#db
            .insertInto('media_tags')
            .values({ blob_id: blobID, title: tags.title, artist: tags.artist, album: tags.album })
            .onConflict((oc) => oc.column('blob_id').doUpdateSet({
                title: tags.title,
                artist: tags.artist,
                album: tags.album,
            }))
            .execute();
    }

    // The backfill sweep's worklist: live audio blobs referenced by at least one file node, with no tags row yet.
    // One row per blob (dedup'd copies extract once); the mime rides along from any referencing node.
    async untaggedAudioBlobs(limit : number) : Promise<UntaggedBlob[]>
    {
        const rows = await this.#db
            .selectFrom('node')
            .innerJoin('blob', 'blob.sha256', 'node.blob_id')
            .leftJoin('media_tags', 'media_tags.blob_id', 'node.blob_id')
            .select([ 'node.blob_id', 'node.mime_type' ])
            .distinct()
            .where('node.type', '=', 'file')
            .where(sql<string>`lower(node.mime_type)`, 'like', 'audio/%')
            .where('blob.deleted_at', 'is', null)
            .where('media_tags.blob_id', 'is', null)
            .limit(limit)
            .execute();

        return rows.flatMap((row) =>
        {
            if(row.blob_id === null || row.mime_type === null) { return []; }

            return [ { blobID: row.blob_id, mimeType: row.mime_type } ];
        });
    }
}

//----------------------------------------------------------------------------------------------------------------------
