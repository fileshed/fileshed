//----------------------------------------------------------------------------------------------------------------------
// Blob Resource Access
//
// The typed client for the claim / proof-of-possession / upload flow. A claim answers a discriminated ClaimResponse: an
// unknown blob gets an upload ticket to PUT bytes against; a known one gets a challenge, answered in a single round
// trip that also commits the node. Both commit paths carry the same two-mode commit metadata -- mint a fresh node, or
// replace an existing one's bytes in place. The upload PUT rides the metadata on the query string and the file bytes as
// a raw body; there is no upload progress here (fetch exposes none), so a progress bar belongs to the upload manager
// (XHR, see uploadWithProgress), not this layer.
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
import { type QueryParams, requestJson, requestUpload } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

// The commit metadata as upload query params. CREATE carries name/parent/mimeType; REPLACE carries the target node id
// and, when the new content changes type, its mimeType, plus an optional ifBlobID concurrency guard. A null parentID,
// an absent replace mimeType, and an absent ifBlobID drop out of the query -- root placement, "keep the node's current
// type", and last-write-wins respectively. Shared by the ticket PUT and the XHR upload so both place the resulting node
// identically.
export function commitQuery(commit : UploadCommitMetadata) : QueryParams
{
    return 'replaceNodeID' in commit
        ? { replaceNodeID: commit.replaceNodeID, mimeType: commit.mimeType, ifBlobID: commit.ifBlobID }
        : { name: commit.name, parentID: commit.parentID, mimeType: commit.mimeType };
}

//----------------------------------------------------------------------------------------------------------------------

export async function claimBlob(request : ClaimRequest) : Promise<ClaimResponse>
{
    return requestJson('/api/blobs/claim', { method: 'POST', body: request, codec: claimResponseCodec });
}

// Answer a proof-of-possession challenge. The body carries the HMAC answer plus the commit metadata, since a successful
// proof commits the node in the same round trip -- no bytes are uploaded.
export async function answerChallenge(challengeID : string, request : ChallengeAnswerRequest) : Promise<NodeResponse>
{
    return requestJson(`/api/blobs/claim/${ challengeID }`, {
        method: 'POST',
        body: request,
        codec: nodeResponseCodec,
    });
}

// Stream a file's bytes against an upload ticket, committing the placed node. The commit metadata rides the query
// string (the body is raw bytes).
export async function uploadTicket(
    ticket : string,
    body : BodyInit,
    commit : UploadCommitMetadata
) : Promise<NodeResponse>
{
    return requestUpload(`/api/uploads/${ ticket }`, {
        query: commitQuery(commit),
        body,
        contentType: 'application/octet-stream',
        codec: nodeResponseCodec,
    });
}

//----------------------------------------------------------------------------------------------------------------------
