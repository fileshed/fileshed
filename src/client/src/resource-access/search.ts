//----------------------------------------------------------------------------------------------------------------------
// Search Resource Access
//
// The typed client for GET /api/search -- a name match scoped to the nodes the caller can access, answered with the
// ordinary paginated node envelope. limit and offset default server-side; a blank query is a 400.
//----------------------------------------------------------------------------------------------------------------------

import { type NodeListResponse, nodeListResponseCodec } from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface SearchPagination
{
    limit ?: number;
    offset ?: number;
}

export async function search(q : string, pagination : SearchPagination = {}) : Promise<NodeListResponse>
{
    return requestJson('/api/search', {
        query: { q, limit: pagination.limit, offset: pagination.offset },
        codec: nodeListResponseCodec,
    });
}

//----------------------------------------------------------------------------------------------------------------------
