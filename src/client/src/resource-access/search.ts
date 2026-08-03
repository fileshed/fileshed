//----------------------------------------------------------------------------------------------------------------------
// Search Resource Access
//
// The typed client for GET /api/search -- a name match scoped to the nodes the caller can access, answered with the
// paginated node envelope plus a location per hit. limit and offset default server-side; a blank query is a 400.
//----------------------------------------------------------------------------------------------------------------------

import { type SearchResponse, searchResponseCodec } from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface SearchOptions
{
    limit ?: number;
    offset ?: number;

    // Aborting rejects with the signal's DOMException; the typeahead uses it to drop a superseded keystroke's answer.
    signal ?: AbortSignal;
}

export async function search(q : string, options : SearchOptions = {}) : Promise<SearchResponse>
{
    return requestJson('/api/search', {
        query: { q, limit: options.limit, offset: options.offset },
        codec: searchResponseCodec,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
}

//----------------------------------------------------------------------------------------------------------------------
