//----------------------------------------------------------------------------------------------------------------------
// Me Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { meResponseCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const meSpec = describeRoute({
    tags: [ 'Me' ],
    summary: 'Get the current user',
    description: 'The caller\'s own profile plus live quota usage, computed fresh from the bytes of the file nodes '
        + 'they own. A null quota limit means unlimited.',
    responses: {
        200: jsonResponse('The caller\'s profile and quota.', meResponseCodec),
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
