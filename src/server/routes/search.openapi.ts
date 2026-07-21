//----------------------------------------------------------------------------------------------------------------------
// Search Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { nodeListResponseCodec, searchQueryCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonResponse, queryParams } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const searchSpec = describeRoute({
    tags: [ 'Search' ],
    summary: 'Search nodes by name',
    description: 'A name match scoped to the nodes the caller can reach: every candidate\'s effective role is resolved '
        + 'and the ones that resolve to no access drop out, so a page never leaks a node the caller cannot see and '
        + 'total counts only what they can reach. A blank or whitespace-only query is rejected.',
    parameters: queryParams(searchQueryCodec),
    responses: {
        200: jsonResponse('A page of accessible matches.', nodeListResponseCodec),
        400: errorResponse('The query is blank or otherwise invalid.'),
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
