//----------------------------------------------------------------------------------------------------------------------
// Me Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { meResponseCodec, updatePreferencesRequestCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonBody, jsonResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const ME_TAG = 'Me';

//----------------------------------------------------------------------------------------------------------------------

export const meSpec = describeRoute({
    tags: [ ME_TAG ],
    summary: 'Get the current user',
    description: 'The caller\'s own profile plus live quota usage, computed fresh from the bytes of the file nodes '
        + 'they own. quota.effective is the cap actually enforced, with the instance default already folded in '
        + '(null = unlimited); quota.limit is the raw per-user setting behind it (null = inherits the default).',
    responses: {
        200: jsonResponse('The caller\'s profile and quota.', meResponseCodec),
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------

export const updatePreferencesSpec = describeRoute({
    tags: [ ME_TAG ],
    summary: 'Update the current user\'s preferences',
    description: 'Merges a partial patch into the caller\'s preferences blob and returns the refreshed profile. A key '
        + 'set to a value updates it; a key set to null deletes it (rootLabel null resets the files-root name to its '
        + 'default). Unknown keys are stored untouched, so a preference written by a newer client is never stripped.',
    requestBody: jsonBody(updatePreferencesRequestCodec),
    responses: {
        200: jsonResponse('The refreshed profile after the merge.', meResponseCodec),
        400: errorResponse('The patch is malformed.'),
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
