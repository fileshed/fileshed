//----------------------------------------------------------------------------------------------------------------------
// Upload Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { nodeResponseCodec, uploadCommitMetadataCodec } from '@fileshed/core';

// Routes
import { binaryBody, errorResponse, jsonResponse, pathParam, queryParams } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const uploadSpec = describeRoute({
    tags: [ 'Uploads' ],
    summary: 'Commit an upload',
    description: 'Streams the raw request body through the store -- which verifies the claimed hash and byte count and '
        + 'rejects a liar -- then creates the caller\'s file node in one transaction. The placement metadata rides the '
        + 'query string since the body is bytes. The ticket is single-use and consumed whether or not the upload '
        + 'lands.',
    parameters: [ pathParam('ticket', 'The upload ticket from the claim.'), ...queryParams(uploadCommitMetadataCodec) ],
    requestBody: binaryBody(),
    responses: {
        200: jsonResponse('The created file node.', nodeResponseCodec),
        400: errorResponse('The metadata is invalid, the body is missing, or the bytes do not match the claim.'),
        401: errorResponse('No session.'),
        403: errorResponse('The ticket belongs to another user, or the write exceeds quota.'),
        404: errorResponse('The ticket is unknown or expired, or the parent does not exist.'),
        413: errorResponse('The upload exceeds the maximum allowed size.'),
        422: errorResponse('The parent placement violates a rule.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
