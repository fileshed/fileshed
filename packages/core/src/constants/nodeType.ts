//----------------------------------------------------------------------------------------------------------------------
// Node Type Constants
//
// The mime membership behind the file type-families. Each mime-based family matches by mime-type prefix (image/*,
// text/*), by exact mime (application/pdf, the archive set), or both. Folders and links are node-type families, not
// mime families, so they never appear here. familyOfMimeType is the one classifier the server's listing filter and the
// client's icon/colour both read, so a mime type resolves to the same family on both sides of the wire.
//----------------------------------------------------------------------------------------------------------------------

import type { NodeTypeFamily } from '../models/requests/nodes.ts';

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
// families (folders, links) are absent here because they classify by node type, not by mime.
export const mimeFamilies
    = [ 'documents', 'pdfs', 'images', 'video', 'audio', 'archives' ] as const satisfies readonly NodeTypeFamily[];
export type MimeFamily = typeof mimeFamilies[number];

// A family's mime membership: a mime belongs when its leading text matches one of the prefixes, or when it equals one
// of the exact entries.
export interface MimeFamilySpec
{
    prefixes : readonly string[];
    exact : readonly string[];
}

export const MIME_FAMILY_SPECS : Readonly<Record<MimeFamily, MimeFamilySpec>> = {
    documents: { prefixes: [ 'text/' ], exact: [] },
    pdfs: { prefixes: [], exact: [ 'application/pdf' ] },
    images: { prefixes: [ 'image/' ], exact: [] },
    video: { prefixes: [ 'video/' ], exact: [] },
    audio: { prefixes: [ 'audio/' ], exact: [] },
    archives: { prefixes: [], exact: ARCHIVE_MIME_TYPES },
};

// The file type-family a mime type belongs to, or null when it matches none (an unclassified binary). The families are
// mutually exclusive by mime, so the iteration order only decides ties that cannot currently arise.
export function familyOfMimeType(mimeType : string) : NodeTypeFamily | null
{
    for(const family of mimeFamilies)
    {
        const spec = MIME_FAMILY_SPECS[family];
        if(spec.prefixes.some((prefix) => mimeType.startsWith(prefix))) { return family; }
        if(spec.exact.includes(mimeType)) { return family; }
    }

    return null;
}

//----------------------------------------------------------------------------------------------------------------------
