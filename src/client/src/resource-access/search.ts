//----------------------------------------------------------------------------------------------------------------------
// Search Resource Access
//
// A blank query is a 400.
//----------------------------------------------------------------------------------------------------------------------

import { type SearchResponse, searchResponseCodec } from '@fileshed/core';

// Resource Access
import { requestJSON } from './request.ts';

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
    return requestJSON('/api/search', {
        query: { q, limit: options.limit, offset: options.offset },
        codec: searchResponseCodec,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
}

//----------------------------------------------------------------------------------------------------------------------
