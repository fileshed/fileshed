//----------------------------------------------------------------------------------------------------------------------
// Direct Link Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Routes
import { binaryResponse, emptyResponse, errorResponse, pathParam } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const directSpec = describeRoute({
    tags: [ 'Direct' ],
    summary: 'Serve a file by public token',
    description: 'The anonymous, hotlinkable direct link: the token is the capability, so there is no session. It '
        + 'serves the linked file\'s bytes with the same range/ETag contract as the authenticated download. A dead '
        + 'link -- unknown token, revoked, or a target that is gone or trashed -- is a 404 that never says which.',
    security: [],
    parameters: [
        pathParam('token', 'The public link token.'),
        {
            name: 'Range',
            in: 'header',
            required: false,
            description: 'An optional single byte range (RFC 7233).',
            schema: { type: 'string' },
        },
        {
            name: 'If-None-Match',
            in: 'header',
            required: false,
            description: 'A prior ETag; a match yields 304 Not Modified.',
            schema: { type: 'string' },
        },
    ],
    responses: {
        200: binaryResponse('The full file.'),
        206: binaryResponse('The requested byte range.'),
        304: emptyResponse('The cached representation is still current.'),
        404: errorResponse('The link is dead.'),
        416: emptyResponse('The requested range is not satisfiable.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
