//----------------------------------------------------------------------------------------------------------------------
// Access Request Route OpenAPI Specs
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { accessRequestListResponseCodec, accessRequestResponseCodec, createAccessRequestCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonBody, jsonResponse, pathParam } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const ACCESS_TAG = 'Access Requests';

const requestIDParam = pathParam('id', 'The access request ID.');

//----------------------------------------------------------------------------------------------------------------------

export const requestAccessSpec = describeRoute({
    tags: [ ACCESS_TAG ],
    summary: 'Request access to a node',
    description: 'A user who can see a stub but cannot resolve it asks the target\'s owner for access at some role. '
        + 'Rejected if the caller already holds any access, or already has a pending request on this node -- these '
        + 'requests are for outsiders, not upgrades.',
    parameters: [ pathParam('id', 'The node ID.') ],
    requestBody: jsonBody(createAccessRequestCodec),
    responses: {
        201: jsonResponse('The created pending request.', accessRequestResponseCodec),
        400: errorResponse('The body is invalid, or the caller already has access or a pending request.'),
        401: errorResponse('No session.'),
        404: errorResponse('No node at this ID.'),
    },
});

export const listAccessRequestsSpec = describeRoute({
    tags: [ ACCESS_TAG ],
    summary: 'List access requests',
    description: 'Both directions in one payload: the pending requests routed to the caller as an owner (the '
        + 'actionable view), and the caller\'s own requests with their current status.',
    responses: {
        200: jsonResponse('Incoming and outgoing requests.', accessRequestListResponseCodec),
        401: errorResponse('No session.'),
    },
});

export const grantAccessRequestSpec = describeRoute({
    tags: [ ACCESS_TAG ],
    summary: 'Grant an access request',
    description: 'The target\'s owner grants a pending request, minting the share and resolving the request in one '
        + 'transaction. Only the owner may resolve, and only a pending request.',
    parameters: [ requestIDParam ],
    responses: {
        200: jsonResponse('The resolved request.', accessRequestResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own the target node.'),
        404: errorResponse('No access request at this ID.'),
        422: errorResponse('The request is already resolved.'),
    },
});

export const declineAccessRequestSpec = describeRoute({
    tags: [ ACCESS_TAG ],
    summary: 'Decline an access request',
    description: 'The target\'s owner declines a pending request. Only the owner may resolve, and only a pending '
        + 'request.',
    parameters: [ requestIDParam ],
    responses: {
        200: jsonResponse('The resolved request.', accessRequestResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('The caller does not own the target node.'),
        404: errorResponse('No access request at this ID.'),
        422: errorResponse('The request is already resolved.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
