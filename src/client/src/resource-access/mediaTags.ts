//----------------------------------------------------------------------------------------------------------------------
// Media Tags Resource Access
//
// Tags sit at the front of most files, so the fetch is aborted the moment the parser has them; a read costs header
// bytes, not the download. Untagged, unparseable, and unreadable files all resolve to null rather than throwing, since
// a file without tags plays under its own name. Artwork is handed out as an object URL whose lifetime the caller owns,
// releasing it through releaseMediaTags when the session ends.
//----------------------------------------------------------------------------------------------------------------------

import { parseWebStream, selectCover } from 'music-metadata';

// Models
import { ARTWORK_MIME_TYPES, isOneOf } from '@fileshed/core';

// Resource Access
import { downloadURL } from './downloads.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface MediaTags
{
    title : string | null;
    artist : string | null;
    album : string | null;
    artworkURL : string | null;
}

//----------------------------------------------------------------------------------------------------------------------

// An object URL takes its type from whatever is handed to it, and the cover's format comes off the tag frame verbatim.
// A blob: URL has no HTTP response, so no header can ever say what it is -- the allowlist is the only thing that can.
// A cover claiming anything else is dropped rather than coerced: it would not render under a corrected type anyway.
function artworkURLOf(data : Uint8Array<ArrayBuffer>, format : string) : string | null
{
    const [ media ] = format.toLowerCase().split(';');
    if(media === undefined || !isOneOf(ARTWORK_MIME_TYPES, media.trim())) { return null; }

    return URL.createObjectURL(new Blob([ data ], { type: media.trim() }));
}

//----------------------------------------------------------------------------------------------------------------------

export async function readMediaTags(nodeID : string) : Promise<MediaTags | null>
{
    const controller = new AbortController();

    try
    {
        const response = await fetch(downloadURL(nodeID, 'inline'), { signal: controller.signal });
        if(!response.ok || response.body === null) { return null; }

        const declaredSize = Number(response.headers.get('content-length') ?? '');
        const metadata = await parseWebStream(
            response.body,
            {
                mimeType: response.headers.get('content-type') ?? undefined,
                size: Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : undefined,
            },
            { duration: false, skipPostHeaders: true }
        );

        const { common } = metadata;
        const cover = selectCover(common.picture);

        const tags : MediaTags = {
            title: common.title?.trim() || null,
            artist: (common.artist ?? common.artists?.[0])?.trim() || null,
            album: common.album?.trim() || null,
            artworkURL: cover === null ? null : artworkURLOf(new Uint8Array(cover.data), cover.format),
        };

        const empty = tags.title === null && tags.artist === null && tags.album === null && tags.artworkURL === null;

        return empty ? null : tags;
    }
    catch
    {
        return null;
    }
    finally
    {
        controller.abort();
    }
}

export function releaseMediaTags(tags : MediaTags) : void
{
    if(tags.artworkURL !== null) { URL.revokeObjectURL(tags.artworkURL); }
}

//----------------------------------------------------------------------------------------------------------------------
