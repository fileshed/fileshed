//----------------------------------------------------------------------------------------------------------------------
// Health Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

// Routes
import { jsonResponse } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const healthResponseCodec = z.object({ status: z.literal('ok') });

//----------------------------------------------------------------------------------------------------------------------

export const healthSpec = describeRoute({
    tags: [ 'Health' ],
    summary: 'Liveness check',
    description: 'An unauthenticated liveness probe. Always 200 while the process is serving.',
    security: [],
    responses: {
        200: jsonResponse('The server is up.', healthResponseCodec),
    },
});

//----------------------------------------------------------------------------------------------------------------------
