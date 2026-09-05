//----------------------------------------------------------------------------------------------------------------------
// Media Constants
//----------------------------------------------------------------------------------------------------------------------

// How deep a playlist folder-add descends. Media libraries organize shallow (artist/album/disc); the cap keeps one
// click on a folder from walking an entire drive.
export const MEDIA_FOLDER_ADD_MAX_DEPTH = 8;

//----------------------------------------------------------------------------------------------------------------------

export const PLAYLIST_EXTENSIONS = [ '.m3u', '.m3u8' ] as const;
export const PLAYLIST_MIME_LIST = [ 'audio/x-mpegurl', 'audio/mpegurl', 'application/vnd.apple.mpegurl' ] as const;
export const PLAYLIST_MIME_TYPES = new Set<string>(PLAYLIST_MIME_LIST);

export const PLAYLIST_SAVE_MIME = 'audio/x-mpegurl';

// How many untagged audio blobs one backfill pass extracts. Small on purpose: the sweep is a janitor riding the
// maintenance cadence, not a race to index a library in one tick.
export const MEDIA_TAG_SWEEP_BATCH = 25;

// How much of a title, artist, or album is kept. Tag frames carry whatever the tagger wrote and ride into search
// responses from there, so a megabyte-long title is stored as the front of a title instead.
export const MEDIA_TAG_MAX_LENGTH = 512;

// The image types embedded artwork may claim. The format comes off the tag frame verbatim, and the client turns it
// into a `blob:` URL -- which has no HTTP response, so no response header can ever cover what it is treated as. Every
// entry here is a raster format a browser renders in an <img> and nothing else.
export const ARTWORK_MIME_TYPES = [ 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp' ] as const;

// A playlist by declared type or by extension -- browsers and servers disagree on m3u mimes often enough that the
// name is the more reliable witness. Beside familyOfMimeType because it plays the same classifying role: the drive's
// presentation and the client's open-intent registry both key off it.
export function isPlaylistFile(mimeType : string, name : string) : boolean
{
    if(PLAYLIST_MIME_TYPES.has(mimeType)) { return true; }

    const lower = name.toLowerCase();

    return PLAYLIST_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

//----------------------------------------------------------------------------------------------------------------------
