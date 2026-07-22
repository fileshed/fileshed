//----------------------------------------------------------------------------------------------------------------------
// Upload Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { nodeResponseCodec, uploadCommitCreateCodec, uploadCommitReplaceCodec } from '@fileshed/core';

// Routes
import { binaryBody, errorResponse, jsonResponse, pathParam, unionQueryParams } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const uploadSpec = describeRoute({
    tags: [ 'Uploads' ],
    summary: 'Commit an upload',
    description: 'Streams the raw request body through the store -- which verifies the claimed hash and byte count and '
        + 'rejects a liar -- then commits the file node in one transaction. The commit metadata rides the query string '
        + 'since the body is bytes: either name/parentID/mimeType to create a new node, or replaceNodeID (with an '
        + 'optional mimeType) to overwrite an existing file\'s content in place, keeping its id. The ticket is '
        + 'single-use and consumed whether or not the upload lands.',
    parameters: [
        pathParam('ticket', 'The upload ticket from the claim.'),
        ...unionQueryParams([ uploadCommitCreateCodec, uploadCommitReplaceCodec ]),
    ],
    requestBody: binaryBody(),
    responses: {
        200: jsonResponse('The created or replaced file node, with the caller\'s effective role.', nodeResponseCodec),
        400: errorResponse('The metadata is invalid, the body is missing, or the bytes do not match the claim.'),
        401: errorResponse('No session.'),
        403: errorResponse('The ticket belongs to another user, the write exceeds the owner\'s quota, or the caller '
            + 'lacks edit access to the replace target.'),
        404: errorResponse('The ticket is unknown or expired, the parent does not exist, or the replace target is not '
            + 'resolvable by the caller.'),
        413: errorResponse('The upload exceeds the maximum allowed size.'),
        422: errorResponse('The parent placement violates a rule, or the replace target is not a file.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
