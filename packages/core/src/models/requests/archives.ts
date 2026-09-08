//----------------------------------------------------------------------------------------------------------------------
// Archive API DTOs
//
// Request contract for GET /api/archives -- a selection of nodes served back as one archive, built and streamed as it
// goes rather than assembled anywhere first.
//
// The ids ride the query string because the browser downloads by navigation: a fetch would have to hold the whole
// archive in memory before it could be saved, which is the thing this endpoint exists to avoid. That puts a real
// ceiling on how many ids one request can name, hence MAX_ARCHIVE_NODES -- it bounds the SELECTION, not the archive:
// a folder in the selection carries however much it contains.
//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------

// Both cover every platform worth covering, and both stream. 7z is deliberately absent: no streaming-friendly
// implementation exists without native code.
export const archiveFormats = [ 'zip', 'tgz' ] as const;
export type ArchiveFormat = typeof archiveFormats[number];

export interface ArchiveQuery
{
    // The selected node ids, comma-separated on the wire and split here.
    ids : string[];
    format : ArchiveFormat;
}

//----------------------------------------------------------------------------------------------------------------------
