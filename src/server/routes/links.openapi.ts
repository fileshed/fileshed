//----------------------------------------------------------------------------------------------------------------------
// Public Link Management Route OpenAPI Specs
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { createPublicLinkRequestCodec, publicLinkListResponseCodec, publicLinkResponseCodec } from '@fileshed/core';

// Routes
import { emptyResponse, errorResponse, jsonBody, jsonResponse, pathParam } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const LINK_TAG = 'Links';

//----------------------------------------------------------------------------------------------------------------------

export const createLinkSpec = describeRoute({
    tags: [ LINK_TAG ],
    summary: 'Create a public link',
    description: 'Mints a hotlinkable public link on a file node, owner-only. Folders carry no bytes to serve, so a '
        + 'non-file is refused. Multiple links per node are allowed (for example one inline, one download).',
    parameters: [ pathParam('id', 'The file node ID.') ],
    requestBody: jsonBody(createPublicLinkRequestCodec),
    responses: {
        201: jsonResponse('The created link.', publicLinkResponseCodec),
        400: errorResponse('The body is invalid, or the node is not a file.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own this node.'),
        404: errorResponse('No node at this ID.'),
    },
});

export const listLinksSpec = describeRoute({
    tags: [ LINK_TAG ],
    summary: 'List a node\'s public links',
    description: 'The links minted on a node. Owner-only.',
    parameters: [ pathParam('id', 'The node ID.') ],
    responses: {
        200: jsonResponse('The node\'s public links.', publicLinkListResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own this node.'),
        404: errorResponse('No node at this ID.'),
    },
});

export const revokeLinkSpec = describeRoute({
    tags: [ LINK_TAG ],
    summary: 'Revoke a public link',
    description: 'Revokes a public link, owner-only. The token stops serving; a revoked link reads as gone.',
    parameters: [ pathParam('id', 'The public link ID.') ],
    responses: {
        204: emptyResponse('The link was revoked.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own the linked node.'),
        404: errorResponse('No link at this ID.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
