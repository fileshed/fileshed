//----------------------------------------------------------------------------------------------------------------------
// Search Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { searchQueryCodec, searchResponseCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonResponse, queryParams } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const searchSpec = describeRoute({
    tags: [ 'Search' ],
    summary: 'Search nodes by name',
    description: 'A name match scoped to the nodes the caller can reach: every candidate\'s effective role is resolved '
        + 'and the ones that resolve to no access drop out, so a page never leaks a node the caller cannot see and '
        + 'total counts only what they can reach. A blank or whitespace-only query is rejected. Each hit carries its '
        + 'location -- the ancestor chain the caller may see, cut at the first ancestor they cannot resolve.',
    parameters: queryParams(searchQueryCodec),
    responses: {
        200: jsonResponse('A page of accessible matches with their locations.', searchResponseCodec),
        400: errorResponse('The query is blank or otherwise invalid.'),
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
