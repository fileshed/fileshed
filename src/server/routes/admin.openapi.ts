//----------------------------------------------------------------------------------------------------------------------
// Admin Route OpenAPI Specs
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import {
    adminStatusResponseCodec,
    adminUserPageResponseCodec,
    adminUserResponseCodec,
    banUserRequestCodec,
    setPasswordRequestCodec,
    setQuotaRequestCodec,
    setRoleRequestCodec,
} from '@fileshed/core';

// Routes
import { errorResponse, jsonBody, jsonResponse, pathParam } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const listUsersSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'List users',
    description: 'A page of user rows (profile plus charged bytes), admin-only. limit and offset are clamped into '
        + 'range rather than rejected; an unrecognized sort key or search field falls back to the default the same '
        + 'way, so out-of-bounds listing options are a convenience the caller does not have to get exactly right.',
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
        {
            name: 'search',
            in: 'query',
            required: false,
            description: 'Substring to match; absent means unfiltered.',
            schema: { type: 'string' },
        },
        {
            name: 'searchField',
            in: 'query',
            required: false,
            description: 'Which field the search matches. Defaults to email.',
            schema: { type: 'string', enum: [ 'email', 'name' ] },
        },
        {
            name: 'sortBy',
            in: 'query',
            required: false,
            description: 'Sort key; absent means storage order.',
            schema: { type: 'string', enum: [ 'name', 'email', 'createdAt' ] },
        },
        {
            name: 'sortDirection',
            in: 'query',
            required: false,
            description: 'Sort direction. Defaults to asc.',
            schema: { type: 'string', enum: [ 'asc', 'desc' ] },
        },
    ],
    responses: {
        200: jsonResponse('A page of user rows.', adminUserPageResponseCodec),
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

export const banUserSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'Ban a user',
    description: 'Bans a user, admin-only: sign-in is refused, every session is revoked, and their access tokens '
        + 'are deleted. The expiry is whole days; absent means the ban holds until an admin lifts it. Admins cannot '
        + 'ban themselves.',
    parameters: [ pathParam('id', 'The target user ID.') ],
    requestBody: jsonBody(banUserRequestCodec),
    responses: {
        200: jsonResponse('The updated user row.', adminUserResponseCodec),
        400: errorResponse('Self-ban, or a malformed body.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller is not an admin.'),
        404: errorResponse('No user at this ID.'),
    },
});

export const unbanUserSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'Unban a user',
    description: 'Lifts a ban, admin-only. The reason and expiry are cleared; access tokens deleted by the ban do '
        + 'not come back.',
    parameters: [ pathParam('id', 'The target user ID.') ],
    responses: {
        200: jsonResponse('The updated user row.', adminUserResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('The caller is not an admin.'),
        404: errorResponse('No user at this ID.'),
    },
});

export const setRoleSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'Change a user\'s role',
    description: 'Promotes to admin or demotes to user, admin-only. An admin cannot demote themselves -- the guard '
        + 'that keeps the last admin from locking the instance.',
    parameters: [ pathParam('id', 'The target user ID.') ],
    requestBody: jsonBody(setRoleRequestCodec),
    responses: {
        200: jsonResponse('The updated user row.', adminUserResponseCodec),
        400: errorResponse('Self-demotion, or a malformed body.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller is not an admin.'),
        404: errorResponse('No user at this ID.'),
    },
});

export const setPasswordSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'Set a user\'s password',
    description: 'Sets a new password for a user, admin-only -- the password-reset path for instances without '
        + 'email. Existing sessions survive; revoking them is its own action.',
    parameters: [ pathParam('id', 'The target user ID.') ],
    requestBody: jsonBody(setPasswordRequestCodec),
    responses: {
        204: { description: 'The password is set.' },
        400: errorResponse('The password does not meet the length requirements.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller is not an admin.'),
        404: errorResponse('No user at this ID.'),
    },
});

export const revokeSessionsSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'Sign a user out everywhere',
    description: 'Revokes every session a user holds, admin-only. A signed session cookie can outlive its row by '
        + 'up to the cookie-cache window (about a minute).',
    parameters: [ pathParam('id', 'The target user ID.') ],
    responses: {
        204: { description: 'All sessions are revoked.' },
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
