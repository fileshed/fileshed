//----------------------------------------------------------------------------------------------------------------------
// Download Resource Access
//
// The authed download (GET /api/nodes/:id/download) streams bytes, not JSON, and is triggered by a browser navigation:
// a same-origin href sends the session cookie on its own, so the browser handles the transfer, Range, and the
// save-vs-preview dialog with no fetch to wrap. This is therefore a URL builder, not a request wrapper. disposition is
// optional -- omitted, the server forces a download (attachment); pass 'inline' for a browser preview.
//----------------------------------------------------------------------------------------------------------------------

import type { PublicLinkDisposition } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export function downloadUrl(nodeID : string, disposition ?: PublicLinkDisposition) : string
{
    const base = `/api/nodes/${ nodeID }/download`;

    return disposition === undefined ? base : `${ base }?disposition=${ disposition }`;
}

//----------------------------------------------------------------------------------------------------------------------
