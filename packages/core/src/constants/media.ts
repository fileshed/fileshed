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
