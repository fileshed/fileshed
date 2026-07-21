//----------------------------------------------------------------------------------------------------------------------
// Admin Route OpenAPI Specs
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import {
    adminStatusResponseCodec,
    adminUserPageResponseCodec,
    adminUserResponseCodec,
    setQuotaRequestCodec,
} from '@fileshed/core';

// Routes
import { errorResponse, jsonBody, jsonResponse, pathParam } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const listUsersSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'List users',
    description: 'A page of user profiles, admin-only. limit and offset are clamped into range rather than rejected, '
        + 'so out-of-bounds pagination is a convenience the caller does not have to get exactly right.',
    parameters: [
        {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Page size; clamped into range.',
            schema: { type: 'integer', minimum: 1 },
        },
        {
            name: 'offset',
            in: 'query',
            required: false,
            description: 'Rows to skip; floored at 0.',
            schema: { type: 'integer', minimum: 0 },
        },
    ],
    responses: {
        200: jsonResponse('A page of user profiles.', adminUserPageResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('The caller is not an admin.'),
    },
});

export const setQuotaSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'Set a user\'s quota',
    description: 'Sets (or clears, with null) a user\'s byte quota, admin-only. A negative or fractional limit is a '
        + 'malformed request, rejected before any write.',
    parameters: [ pathParam('id', 'The target user ID.') ],
    requestBody: jsonBody(setQuotaRequestCodec),
    responses: {
        200: jsonResponse('The updated user profile.', adminUserResponseCodec),
        400: errorResponse('The request body does not match the expected shape.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller is not an admin.'),
        404: errorResponse('No user at this ID.'),
    },
});

export const adminStatusSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'Get server status',
    description: 'The configured storage backends and the last outcome of each background sweep, admin-only. A sweep '
        + 'that has not run this process reports null. Backend credentials are never included.',
    responses: {
        200: jsonResponse('Backends and last sweep outcomes.', adminStatusResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('The caller is not an admin.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
