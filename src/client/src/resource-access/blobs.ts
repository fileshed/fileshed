//----------------------------------------------------------------------------------------------------------------------
// Blob Resource Access
//----------------------------------------------------------------------------------------------------------------------

import {
    type ChallengeAnswerRequest,
    type ClaimRequest,
    type ClaimResponse,
    type NodeResponse,
    type UploadCommitMetadata,
    claimResponseCodec,
    nodeResponseCodec,
} from '@fileshed/core';

// Resource Access
import { type QueryParams, requestJSON } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

// The commit metadata as upload query params. CREATE carries name/parent/mimeType; REPLACE carries the target node id
// and, when the new content changes type, its mimeType, plus an optional ifBlobID concurrency guard. A null parentID,
// an absent replace mimeType, and an absent ifBlobID drop out of the query -- root placement, "keep the node's current
// type", and last-write-wins respectively.
export function commitQuery(commit : UploadCommitMetadata) : QueryParams
{
    return 'replaceNodeID' in commit
        ? { replaceNodeID: commit.replaceNodeID, mimeType: commit.mimeType, ifBlobID: commit.ifBlobID }
        : { name: commit.name, parentID: commit.parentID, mimeType: commit.mimeType };
}

//----------------------------------------------------------------------------------------------------------------------

export async function claimBlob(request : ClaimRequest) : Promise<ClaimResponse>
{
    return requestJSON('/api/blobs/claim', { method: 'POST', body: request, codec: claimResponseCodec });
}

// Answer a proof-of-possession challenge. The body carries the HMAC answer plus the commit metadata, since a successful
// proof commits the node in the same round trip -- no bytes are uploaded.
export async function answerChallenge(challengeID : string, request : ChallengeAnswerRequest) : Promise<NodeResponse>
{
    return requestJSON(`/api/blobs/claim/${ challengeID }`, {
        method: 'POST',
        body: request,
        codec: nodeResponseCodec,
    });
}

//----------------------------------------------------------------------------------------------------------------------
