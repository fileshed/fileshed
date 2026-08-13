//----------------------------------------------------------------------------------------------------------------------
// Upload Route OpenAPI Spec
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import {
    nodeResponseCodec,
    uploadChunkAcceptedCodec,
    uploadCommitCreateCodec,
    uploadCommitReplaceCodec,
} from '@fileshed/core';

// Routes
import { binaryBody, errorResponse, jsonResponse, pathParam, unionQueryParams } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

export const uploadSpec = describeRoute({
    tags: [ 'Uploads' ],
    summary: 'Commit an upload',
    description: 'Streams the raw request body through the store -- which verifies the claimed hash and byte count and '
        + 'rejects a liar -- then commits the file node in one transaction. The commit metadata rides the query string '
        + 'since the body is bytes: either name/parentID/mimeType to create a new node, or replaceNodeID (with an '
        + 'optional mimeType) to overwrite an existing file\'s content in place, keeping its id. A replace may carry '
        + 'an optional ifBlobID to guard against a concurrent edit: the commit is refused if the target\'s current '
        + 'blob is no longer that one.\n\n'
        + 'The body may carry one chunk of the file instead of all of it, with `offset` naming the byte it starts at. '
        + 'Chunks are sequential: each must start exactly where the last one ended, and the one that carries the final '
        + 'byte verifies the whole file and commits it. An incomplete upload answers 202 with the bytes received so '
        + 'far. The ticket lives until the file is complete, so a failed chunk is retried on its own; a request that '
        + 'carries the whole claimed size is single-use as ever, consumed whether or not it lands. The chunk size to '
        + 'cut the file into came back with the ticket, in the claim\'s `chunkBytes`.',
    parameters: [
        pathParam('ticket', 'The upload ticket from the claim.'),
        {
            name: 'offset',
            in: 'query',
            required: false,
            description: 'The byte this chunk starts at. Absent means the start of the file.',
            schema: { type: 'integer', minimum: 0 },
        },
        ...unionQueryParams([ uploadCommitCreateCodec, uploadCommitReplaceCodec ]),
    ],
    requestBody: binaryBody(),
    responses: {
        200: jsonResponse('The created or replaced file node, with the caller\'s effective role.', nodeResponseCodec),
        202: jsonResponse(
            'The chunk landed and the file is still incomplete; the upload\'s new position.',
            uploadChunkAcceptedCodec
        ),
        400: errorResponse('The metadata is invalid, the body is missing, the offset is malformed or past the end of '
            + 'the file, the chunk would carry the upload past the claimed size, or the bytes do not match the claim.'),
        401: errorResponse('No session.'),
        403: errorResponse('The ticket belongs to another user, the write exceeds the owner\'s quota, or the caller '
            + 'lacks edit access to the replace target.'),
        404: errorResponse('The ticket is unknown or expired, the parent does not exist, or the replace target is not '
            + 'resolvable by the caller.'),
        409: errorResponse('The chunk repeats or skips ground the upload has already covered '
            + '(`upload.offsetConflict`), another chunk of the same upload is still being received '
            + '(`upload.chunkInFlight`), or the replace carried an ifBlobID guard and the target\'s content changed '
            + 'since (`replace.staleBlob`). The body\'s `code` says which; only `upload.chunkInFlight` clears on its '
            + 'own, so it is the only one worth sending the same chunk again for. An `upload.offsetConflict` carries '
            + 'the upload\'s real position in the body\'s `receivedBytes` -- the byte to cut the next chunk at, so a '
            + 'client that disagreed about where the upload stood resumes there instead of starting over.'),
        413: errorResponse('The upload exceeds the maximum allowed size. The limit is in the body\'s `maxBytes` and '
            + 'in the `Upload-Limit: max-size=<bytes>` response header.'),
        422: errorResponse('The parent placement violates a rule, or the replace target is not a file.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
