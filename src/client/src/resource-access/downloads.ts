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
// Bytes already in the page
//----------------------------------------------------------------------------------------------------------------------

// A URL handed to the browser is revoked on the next turn of the event loop rather than immediately: the navigation or
// the download has started by then, and holding one forever pins its bytes in memory for the life of the tab.
function withObjectURL(bytes : Uint8Array, mimeType : string, use : (url : string) => void) : void
{
    const url = URL.createObjectURL(new Blob([ new Uint8Array(bytes) ], { type: mimeType }));

    use(url);
    setTimeout(() => { URL.revokeObjectURL(url); }, 0);
}

// Save bytes the page already holds, under a name of its choosing. A download attribute on a same-origin object URL is
// how a browser is asked to write a file it was never served: there is no request to make, so this is the whole of it.
export function saveBytes(bytes : Uint8Array, filename : string, mimeType : string) : void
{
    withObjectURL(bytes, mimeType, (url) =>
    {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.rel = 'noopener';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
    });
}

// Point an already-open window at bytes the page holds. The window must be opened by the caller BEFORE it goes async,
// or a popup blocker refuses it -- a window.open that is not a direct consequence of a click is not a user gesture.
export function showBytesIn(target : Window, bytes : Uint8Array, mimeType : string) : void
{
    withObjectURL(bytes, mimeType, (url) => { target.location.href = url; });
}

//----------------------------------------------------------------------------------------------------------------------
