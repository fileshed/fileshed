//----------------------------------------------------------------------------------------------------------------------
// Blob Route OpenAPI Specs
//----------------------------------------------------------------------------------------------------------------------

import { describeRoute } from 'hono-openapi';

// Models
import { challengeAnswerRequestCodec, claimRequestCodec, claimResponseCodec, nodeResponseCodec } from '@fileshed/core';

// Routes
import { errorResponse, jsonBody, jsonResponse, pathParam } from './docSchema.ts';

//----------------------------------------------------------------------------------------------------------------------

const BLOB_TAG = 'Blobs';

//----------------------------------------------------------------------------------------------------------------------

export const claimSpec = describeRoute({
    tags: [ BLOB_TAG ],
    summary: 'Claim a blob',
    description: 'Admits a content-addressed write against the caller\'s quota, then routes it: an unknown blob gets a '
        + 'single-use upload ticket; a known blob large enough to be worth it gets a proof-of-possession challenge '
        + 'instead of re-uploading the bytes. A claimed size that disagrees with a known blob describes content this '
        + 'instance does not hold, and is answered as if it were new.\n\n'
        + 'A ticket carries the chunk size this instance wants the file cut into (`chunkBytes`), which a deployment '
        + 'can raise or lower — plan the upload against that number rather than any compiled-in default.',
    requestBody: jsonBody(claimRequestCodec),
    responses: {
        200: jsonResponse(
            'An upload ticket (with the instance\'s chunk size) or a proof-of-possession challenge.',
            claimResponseCodec
        ),
        400: errorResponse('The claim is malformed.'),
        401: errorResponse('No session.'),
        403: errorResponse('The write would exceed the caller\'s quota, counting the uploads the caller already has '
            + 'outstanding.'),
        413: errorResponse('The file exceeds the maximum upload size. The limit is in the body\'s `maxBytes` and in '
            + 'the `Upload-Limit: max-size=<bytes>` response header.'),
        429: errorResponse('The caller already has the maximum number of uploads outstanding.'),
    },
});

export const answerChallengeSpec = describeRoute({
    tags: [ BLOB_TAG ],
    summary: 'Answer a proof-of-possession challenge',
    description: 'Proves possession of a known blob by answering its challenge, committing with zero bytes moved '
        + '(resurrecting the blob if it was graveyarded). The body carries either the new-node metadata '
        + '(name/parentID/mimeType) or a replaceNodeID (with an optional mimeType) to overwrite an existing file\'s '
        + 'content in place. A replace may carry an optional ifBlobID to guard against a concurrent edit: the commit '
        + 'is refused if the target\'s current blob is no longer that one. A wrong answer is counted toward a per-user '
        + 'rate limit; too many failures are throttled.',
    parameters: [ pathParam('challengeID', 'The challenge ID from the claim.') ],
    requestBody: jsonBody(challengeAnswerRequestCodec),
    responses: {
        200: jsonResponse('The created or replaced file node, with the caller\'s effective role.', nodeResponseCodec),
        400: errorResponse('The request body does not match the expected shape.'),
        401: errorResponse('No session.'),
        403: errorResponse('The proof failed, the challenge belongs to another user, the write exceeds the owner\'s '
            + 'quota, or the caller lacks edit access to the replace target.'),
        404: errorResponse('The challenge is unknown or expired, the blob vanished before it could be proven, or the '
            + 'replace target is not resolvable by the caller.'),
        409: errorResponse('The replace carried an ifBlobID guard and the target\'s content changed since; reload and '
            + 'retry. The body\'s `code` reads `replace.staleBlob`.'),
        422: errorResponse('The parent placement violates a rule, or the replace target is not a file.'),
        429: errorResponse('Too many failed proofs; try again later.'),
    },
});

//----------------------------------------------------------------------------------------------------------------------
