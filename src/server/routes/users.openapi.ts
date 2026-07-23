//----------------------------------------------------------------------------------------------------------------------
// User Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { userLookupQueryCodec, userSummaryCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonResponse, queryParams } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const USER_TAG = 'Users';

//----------------------------------------------------------------------------------------------------------------------

export const lookupUserSpec = describeRoute({
    tags: [ USER_TAG ],
    summary: 'Look up a user by exact email',
    description: 'Resolves an exact email address to a user summary, so a sharer can confirm who they are about to '
        + 'grant before granting. Exact whole-email match only -- no prefix or substring search -- so the endpoint '
        + 'cannot enumerate accounts. An unknown email is a 404.',
    parameters: queryParams(userLookupQueryCodec),
    responses: {
        200: jsonResponse('The matched user summary.', userSummaryCodec),
        400: errorResponse('The email query parameter is missing or blank.'),
        401: errorResponse('No session.'),
        404: errorResponse('No user with that email.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
