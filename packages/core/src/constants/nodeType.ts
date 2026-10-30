//----------------------------------------------------------------------------------------------------------------------
// Node Type Constants
//
// Folders and links are node-type families rather than mime families, so they never appear here. The server's listing
// filter builds its query from MIME_FAMILY_SPECS, and familyOfMimeType (utils/mimeType.ts) classifies from the same
// table, so a mime type resolves to the same family on both sides of the wire.
//----------------------------------------------------------------------------------------------------------------------

import type { NodeTypeFamily } from '../models/requests/nodes.ts';

import { PLAYLIST_MIME_LIST } from './media.ts';

//----------------------------------------------------------------------------------------------------------------------

// One representative mime per common archive format -- a file is an archive when its stored mime equals one exactly.
export const ARCHIVE_MIME_TYPES
    = [
        'application/zip',
        'application/x-tar',
        'application/gzip',
        'application/x-7z-compressed',
        'application/x-rar-compressed',
    ] as const;

// The file type-families, in the order familyOfMimeType tests them. A curated subset of nodeTypeFamilies: the node-type
// families (folders, links) are absent here because they classify by node type, not by mime. Order carries one real
// tie: playlist mimes also match audio's prefix (audio/x-mpegurl), so playlists sits before audio and wins.
export const mimeFamilies
    = [
        'documents',
        'pdfs',
        'images',
        'video',
        'playlists',
        'audio',
        'archives',
    ] as const satisfies readonly NodeTypeFamily[];
export type MimeFamily = typeof mimeFamilies[number];

// A family's mime membership: a mime belongs when its leading text matches one of the prefixes, or when it equals one
// of the exact entries.
export interface MimeFamilySpec
{
    prefixes : readonly string[];
    exact : readonly string[];
}

export const MIME_FAMILY_SPECS : Readonly<Record<MimeFamily, MimeFamilySpec>> = {
    documents: {
        prefixes: [ 'text/' ],
        exact: [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.oasis.opendocument.text',
            'application/msword',
        ],
    },
    pdfs: { prefixes: [], exact: [ 'application/pdf' ] },
    images: { prefixes: [ 'image/' ], exact: [] },
    video: { prefixes: [ 'video/' ], exact: [] },
    playlists: { prefixes: [], exact: PLAYLIST_MIME_LIST },
    audio: { prefixes: [ 'audio/' ], exact: [] },
    archives: { prefixes: [], exact: ARCHIVE_MIME_TYPES },
};

//----------------------------------------------------------------------------------------------------------------------
