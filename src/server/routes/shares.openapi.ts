//----------------------------------------------------------------------------------------------------------------------
// Share Route OpenAPI Specs
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import {
    grantShareRequestCodec,
    shareListResponseCodec,
    shareResponseCodec,
    sharedWithMeQueryCodec,
    sharedWithMeResponseCodec,
} from '@fileshed/core';

// Routes
import { emptyResponse, errorResponse, jsonBody, jsonResponse, pathParam, queryParams } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const SHARE_TAG = 'Shares';

const nodeIDParam = pathParam('id', 'The node ID.');
const shareIDParam = pathParam('id', 'The share ID.');

//----------------------------------------------------------------------------------------------------------------------

export const grantShareSpec = describeRoute({
    tags: [ SHARE_TAG ],
    summary: 'Share a node',
    description: 'Grants a user a role on a node, owner-only in v1. A grantee who already holds a grant has their role '
        + 'updated in place rather than a conflict raised. A node cannot be self-granted, and a link cannot be shared.',
    parameters: [ nodeIDParam ],
    requestBody: jsonBody(grantShareRequestCodec),
    responses: {
        201: jsonResponse('The created (or updated) grant.', shareResponseCodec),
        400: errorResponse('The request body does not match the expected shape.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own this node.'),
        404: errorResponse('No node at this ID.'),
        422: errorResponse('The grant is self-directed, or the node is a link.'),
    },
});

export const listNodeSharesSpec = describeRoute({
    tags: [ SHARE_TAG ],
    summary: 'List a node\'s shares',
    description: 'The owner\'s view of who a node is shared with, each grant paired with its grantee\'s user summary. '
        + 'Owner-only.',
    parameters: [ nodeIDParam ],
    responses: {
        200: jsonResponse('The node\'s grants, each with its grantee\'s summary.', shareListResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own this node.'),
        404: errorResponse('No node at this ID.'),
    },
});

export const sharedWithMeSpec = describeRoute({
    tags: [ SHARE_TAG ],
    summary: 'List shares granted to the caller',
    description: 'The caller\'s active shares, each with the target\'s summary, the target owner\'s display summary, '
        + 'and whether the caller has placed a link to it in their own tree. Optionally filtered by the target\'s type '
        + 'family and last-modified window, the same Type and Modified filters the drive listing takes.',
    parameters: queryParams(sharedWithMeQueryCodec),
    responses: {
        200: jsonResponse('The shares granted to the caller.', sharedWithMeResponseCodec),
        400: errorResponse('The query parameters are invalid.'),
        401: errorResponse('No session.'),
    },
});

export const leaveShareSpec = describeRoute({
    tags: [ SHARE_TAG ],
    summary: 'Leave a share',
    description: 'The grantee removes their own grant. Their links to the target go dead and persist as stubs; '
        + 'cleaning them up is a separate action.',
    parameters: [ shareIDParam ],
    responses: {
        204: emptyResponse('The share was left.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller is not the grantee of this share.'),
        404: errorResponse('No share at this ID.'),
    },
});

export const revokeShareSpec = describeRoute({
    tags: [ SHARE_TAG ],
    summary: 'Revoke a share',
    description: 'The owner ends someone else\'s access. The recipient\'s links go dead and persist as stubs. '
        + 'Owner-only.',
    parameters: [ shareIDParam ],
    responses: {
        204: emptyResponse('The share was revoked.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own the shared node.'),
        404: errorResponse('No share at this ID.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
