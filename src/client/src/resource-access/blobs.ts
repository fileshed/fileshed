//----------------------------------------------------------------------------------------------------------------------
// Blob Resource Access
//
// The typed client for the claim / proof-of-possession / upload flow. A claim answers a discriminated ClaimResponse: an
// unknown blob gets an upload ticket to PUT bytes against; a known one gets a challenge, answered in a single round
// trip that also commits the node. The upload PUT carries the placement metadata on the query string and the file
// bytes as a raw body -- see requestUpload. There is no upload progress here: fetch exposes none, so a progress bar
// belongs to the upload manager (XHR), not this layer.
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
import { requestJson, requestUpload } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function claimBlob(request : ClaimRequest) : Promise<ClaimResponse>
{
    return requestJson('/api/blobs/claim', { method: 'POST', body: request, codec: claimResponseCodec });
}

// Answer a proof-of-possession challenge. The body carries the HMAC answer plus the placement metadata, since a
// successful proof commits the node in the same round trip -- no bytes are uploaded.
export async function answerChallenge(challengeID : string, request : ChallengeAnswerRequest) : Promise<NodeResponse>
{
    return requestJson(`/api/blobs/claim/${ challengeID }`, {
        method: 'POST',
        body: request,
        codec: nodeResponseCodec,
    });
}

// Stream a file's bytes against an upload ticket, committing the placed node. The metadata rides the query string (the
// body is raw bytes); an absent parentID is root placement.
export async function uploadTicket(
    ticket : string,
    body : BodyInit,
    metadata : UploadCommitMetadata
) : Promise<NodeResponse>
{
    return requestUpload(`/api/uploads/${ ticket }`, {
        query: { name: metadata.name, parentID: metadata.parentID, mimeType: metadata.mimeType },
        body,
        contentType: 'application/octet-stream',
        codec: nodeResponseCodec,
    });
}

//----------------------------------------------------------------------------------------------------------------------
