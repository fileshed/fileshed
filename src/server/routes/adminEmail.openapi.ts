//----------------------------------------------------------------------------------------------------------------------
// Admin Email Routes OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { testEmailResponseCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const testEmailSpec = describeRoute({
    tags: [ 'Admin' ],
    summary: 'Send a test email',
    description: 'Sends a test email to the calling admin\'s own address using the current SMTP settings, admin-only. '
        + 'An unconfigured or refusing SMTP server answers 400 carrying the real reason, so the settings can be fixed.',
    responses: {
        200: jsonResponse('The test email was accepted by the SMTP server.', testEmailResponseCodec),
        400: errorResponse('Email is not configured, or the SMTP server refused the send.'),
        401: errorResponse('No session.'),
        403: errorResponse('The caller is not an admin.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
