//----------------------------------------------------------------------------------------------------------------------
// Avatar Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { meResponseCodec } from '@fileshed/core';

// Routes
import {
    binaryBody,
    binaryResponse,
    emptyResponse,
    errorResponse,
    jsonResponse,
    pathParam,
} from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const AVATAR_TAG = 'Avatars';

//----------------------------------------------------------------------------------------------------------------------

export const uploadAvatarSpec = describeRoute({
    tags: [ AVATAR_TAG ],
    summary: 'Set the current user\'s avatar',
    description: 'Streams the raw image body into the content-addressed blob store and points the caller at it, then '
        + 'returns the refreshed profile with its new image URL. The body is the image bytes; its Content-Type names '
        + 'the format, which must be PNG, JPEG, WebP, GIF, or BMP. Charged to no quota, but capped by '
        + 'AVATAR_MAX_BYTES. A '
        + 'previous avatar\'s blob is graveyarded if nothing else references it.',
    requestBody: binaryBody(),
    responses: {
        200: jsonResponse('The refreshed profile, its image URL now pointing at the new avatar.', meResponseCodec),
        400: errorResponse('The body is missing or its format is not an accepted image type.'),
        401: errorResponse('No session.'),
        413: errorResponse('The image exceeds the maximum avatar size.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const deleteAvatarSpec = describeRoute({
    tags: [ AVATAR_TAG ],
    summary: 'Clear the current user\'s avatar',
    description: 'Drops the caller\'s avatar reference and graveyards its blob when nothing else references it. '
        + 'Idempotent: an account with no avatar succeeds and changes nothing.',
    responses: {
        204: emptyResponse('The avatar was cleared.'),
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const getAvatarSpec = describeRoute({
    tags: [ AVATAR_TAG ],
    summary: 'Serve an avatar\'s bytes',
    description: 'Streams the bytes of an avatar by its blob hash, with the stored image mime and a long immutable '
        + 'cache. Authenticated, and served ONLY for a hash some user\'s avatar currently references -- a hash no '
        + 'avatar points at is 404, so this is never a way to pull arbitrary blob-store content by hash.',
    parameters: [ pathParam('sha256', 'The avatar blob\'s sha256.') ],
    responses: {
        200: binaryResponse('The avatar image.'),
        401: errorResponse('No session.'),
        404: errorResponse('No avatar references this hash.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
