//----------------------------------------------------------------------------------------------------------------------
// Media Tags Resource Access
//
// Reads the embedded tags (ID3, MP4 atoms, Vorbis comments) of a media node off the same Range-supporting inline
// download endpoint the players stream from. Tags live at the front of most files, so the fetch is aborted the
// moment the parser has them -- a read costs header bytes, not the download. Untagged, unparseable, and unreadable
// files all resolve to null rather than throwing: tags are garnish, and a file that yields none plays under its
// own name. Artwork is handed out as an object URL; the caller owns its lifetime and releases it through
// releaseMediaTags when the session ends.
//----------------------------------------------------------------------------------------------------------------------

import { parseWebStream, selectCover } from 'music-metadata';

// Resource Access
import { downloadUrl } from './downloads.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface MediaTags
{
    title : string | null;
    artist : string | null;
    album : string | null;
    artworkUrl : string | null;
}

//----------------------------------------------------------------------------------------------------------------------

export async function readMediaTags(nodeID : string) : Promise<MediaTags | null>
{
    const controller = new AbortController();

    try
    {
        const response = await fetch(downloadUrl(nodeID, 'inline'), { signal: controller.signal });
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
            artworkUrl: cover === null
                ? null
                : URL.createObjectURL(new Blob([ new Uint8Array(cover.data) ], { type: cover.format })),
        };

        const empty = tags.title === null && tags.artist === null && tags.album === null && tags.artworkUrl === null;

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
    if(tags.artworkUrl !== null) { URL.revokeObjectURL(tags.artworkUrl); }
}

//----------------------------------------------------------------------------------------------------------------------
