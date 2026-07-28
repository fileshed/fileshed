//----------------------------------------------------------------------------------------------------------------------
// Instance & Setup Routes OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { instanceResponseCodec, setupRequestCodec, setupResponseCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonBody, jsonResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const SETUP_TAG = 'Instance';

//----------------------------------------------------------------------------------------------------------------------

export const instanceSpec = describeRoute({
    tags: [ SETUP_TAG ],
    summary: 'Instance facts for pre-auth pages',
    description: 'Anonymous by design: the sign-in and setup pages need these facts before any session exists. '
        + 'Carries only what is safe in anyone\'s hands.',
    responses: {
        200: jsonResponse('The instance\'s pre-auth facts.', instanceResponseCodec),
    },
});

export const setupSpec = describeRoute({
    tags: [ SETUP_TAG ],
    summary: 'Complete first-run setup',
    description: 'Creates the first admin account, gated by the one-time setup code printed to the server console '
        + '(regenerated every boot until setup completes) or the operator\'s FILESHED_SETUP_TOKEN. Once any account '
        + 'exists this endpoint is a 404, permanently.',
    requestBody: jsonBody(setupRequestCodec),
    responses: {
        200: jsonResponse('Setup complete; sign in with the created credentials.', setupResponseCodec),
        400: errorResponse('The request is malformed.'),
        401: errorResponse('The setup code is wrong.'),
        404: errorResponse('Setup already completed.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
