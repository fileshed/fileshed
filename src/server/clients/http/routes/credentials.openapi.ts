//----------------------------------------------------------------------------------------------------------------------
// Credential Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Routes
import { errorResponse } from '../utils/docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const revokeAllCredentialsSpec = describeRoute({
    tags: [ 'Me' ],
    summary: 'Revoke every credential the caller holds',
    description: 'Ends every session the caller has, the one making this call included, and revokes every access '
        + 'token they hold. Scoped to the caller: no other account is touched. Session-only, so an access token '
        + 'cannot lock its owner out.',
    responses: {
        204: { description: 'Every session and access token is revoked.' },
        401: errorResponse('No session.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
