//----------------------------------------------------------------------------------------------------------------------
// Version Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { versionResponseCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const versionSpec = describeRoute({
    tags: [ 'Instance' ],
    summary: 'Get the running version',
    description: 'The FileShed release this instance runs, with the commit it was built from and the branch that '
        + 'commit was on. Both are null when the build recorded neither. Requires a session; anonymous callers are '
        + 'refused.',
    responses: {
        200: jsonResponse('The running version.', versionResponseCodec),
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
