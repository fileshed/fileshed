//----------------------------------------------------------------------------------------------------------------------
// Download Resource Access
//
// The authed download (GET /api/nodes/:id/download) streams bytes, not JSON, and is triggered by a browser navigation:
// a same-origin href sends the session cookie on its own, so the browser handles the transfer, Range, and the
// save-vs-preview dialog with no fetch to wrap. This is therefore a URL builder, not a request wrapper. disposition is
// optional -- omitted, the server forces a download (attachment); pass 'inline' for a browser preview.
//
// The archive URL is the same idea for a selection: the ids ride the query string because a fetch would have to hold
// the whole archive in memory before it could be saved, which is what streaming it exists to avoid.
//----------------------------------------------------------------------------------------------------------------------

import type { ArchiveFormat, ContentDisposition } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export function downloadUrl(nodeID : string, disposition ?: ContentDisposition) : string
{
    const base = `/api/nodes/${ nodeID }/download`;

    return disposition === undefined ? base : `${ base }?disposition=${ disposition }`;
}

export function archiveUrl(nodeIDs : readonly string[], format : ArchiveFormat) : string
{
    const params = new URLSearchParams({ ids: nodeIDs.join(','), format });

    return `/api/archives?${ params.toString() }`;
}

//----------------------------------------------------------------------------------------------------------------------
