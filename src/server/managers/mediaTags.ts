//----------------------------------------------------------------------------------------------------------------------
// Media Tag Manager
//
// Orchestrates tag extraction: given a blob and the mime a node claims for it, decide whether extraction applies
// (audio content, not a playlist, not already extracted), stream the bytes from the store, and persist whatever
// the parser found -- including nothing, which still writes the row that marks the blob as done. Called after the
// upload and dedup-claim commits (fire-and-forget: enrichment never delays or fails a write), and by the backfill
// sweep that walks pre-existing libraries.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { PLAYLIST_MIME_TYPES } from '@fileshed/core';

// Resource Access
import type { BlobRA } from '../resource-access/blob/index.ts';
import { type MediaTagsRA, extractTags } from '../resource-access/mediaTags/index.ts';

// Utils
import { getLogger } from '../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('mediaTags');

export interface MediaTagDeps
{
    blob : BlobRA;
    tags : MediaTagsRA;
}

//----------------------------------------------------------------------------------------------------------------------

export class MediaTagManager
{
    readonly #blob : BlobRA;
    readonly #tags : MediaTagsRA;

    constructor(deps : MediaTagDeps)
    {
        this.#blob = deps.blob;
        this.#tags = deps.tags;
    }

    // Extract once per blob. Non-audio content and playlists (audio-mimed, but text inside) are not candidates;
    // an existing row -- even all-null -- means a previous run already answered.
    async ensureFor(blobID : string, mimeType : string | null) : Promise<void>
    {
        if(mimeType === null || !mimeType.startsWith('audio/') || PLAYLIST_MIME_TYPES.has(mimeType)) { return; }
        if(await this.#tags.get(blobID) !== undefined) { return; }

        const blob = await this.#blob.get(blobID);
        if(blob === undefined || blob.deletedAt !== null) { return; }

        const stream = await this.#blob.getStream({ backendID: blob.backendID, storageKey: blob.storageKey });
        const tags = await extractTags(stream);

        await this.#tags.upsert(blobID, tags);
    }

    // The route-facing wrapper: enrichment must never surface as an upload failure, so this swallows with a log.
    enrichInBackground(blobID : string, mimeType : string | null) : void
    {
        this.ensureFor(blobID, mimeType)
            .catch((error) => logger.error({ err: error, blobID }, 'Media tag extraction failed'));
    }

    // One backfill pass over blobs uploaded before extraction existed (or whose extraction was lost). Serial on
    // purpose: this is a background janitor and has no business saturating the blob backend.
    async sweepOnce(batch : number) : Promise<number>
    {
        const candidates = await this.#tags.untaggedAudioBlobs(batch);

        for(const candidate of candidates)
        {
            // eslint-disable-next-line no-await-in-loop -- deliberately serial; a janitor must not stampede the store
            await this.ensureFor(candidate.blobID, candidate.mimeType);
        }

        return candidates.length;
    }
}

//----------------------------------------------------------------------------------------------------------------------
