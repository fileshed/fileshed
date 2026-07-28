//----------------------------------------------------------------------------------------------------------------------
// Admin Settings Routes OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { adminSettingsResponseCodec, patchSettingsRequestCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonBody, jsonResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const SETTINGS_TAG = 'Admin';

//----------------------------------------------------------------------------------------------------------------------

export const getSettingsSpec = describeRoute({
    tags: [ SETTINGS_TAG ],
    summary: 'Read the instance settings',
    description: 'Every admin-tunable key with its effective value, source (config default vs admin override), and '
        + 'application tier. Secret values arrive masked and never leave the server whole.',
    responses: {
        200: jsonResponse('The instance settings.', adminSettingsResponseCodec),
        401: errorResponse('No session.'),
        403: errorResponse('Not an admin.'),
    },
});

export const patchSettingsSpec = describeRoute({
    tags: [ SETTINGS_TAG ],
    summary: 'Change instance settings',
    description: 'Key-wise: a value overrides the config default; null resets the override away. Live-tier keys '
        + 'apply to the next request; restart-tier keys flag the status surface until a restart. Answers the '
        + 'refreshed view.',
    requestBody: jsonBody(patchSettingsRequestCodec),
    responses: {
        200: jsonResponse('The refreshed settings after the patch.', adminSettingsResponseCodec),
        400: errorResponse('A value does not fit its key.'),
        401: errorResponse('No session.'),
        403: errorResponse('Not an admin.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
