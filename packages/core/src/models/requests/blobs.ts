//----------------------------------------------------------------------------------------------------------------------
// Blob API DTOs
//
// Request/response contracts for the claim/proof-of-possession/upload flow. The claim response is a discriminated union
// on `upload` -- an unknown blob gets an upload ticket, a known one a challenge.
//----------------------------------------------------------------------------------------------------------------------

export interface ClaimRequest
{
    sha256 : string;
    size : number;
}

//----------------------------------------------------------------------------------------------------------------------
// Claim response -- an unknown blob gets an upload ticket; a known blob (including graveyarded) gets a proof-of-
// possession challenge instead of a place to put bytes.
//----------------------------------------------------------------------------------------------------------------------

interface ClaimTicketResponse
{
    upload : true;
    ticket : string;
}

interface ClaimChallengeResponse
{
    upload : false;
    challengeID : string;
    nonce : string;
    ranges : [ number, number ][];
}

export type ClaimResponse = ClaimTicketResponse | ClaimChallengeResponse;

//----------------------------------------------------------------------------------------------------------------------
// Placement metadata for the file node a completed upload or an answered challenge creates. Shared
// by both commit paths so the resulting node's name/parent/mimeType are validated identically either way.
//----------------------------------------------------------------------------------------------------------------------

export interface UploadCommitMetadata
{
    name : string;
    parentID : string | null;
    mimeType : string;
}

//----------------------------------------------------------------------------------------------------------------------
// POST /api/blobs/claim/:challengeID -- the HMAC answer plus the placement metadata, since a successful proof commits
// the node in the same round trip and zero bytes are uploaded.
//----------------------------------------------------------------------------------------------------------------------

export interface ChallengeAnswerRequest extends UploadCommitMetadata
{
    answer : string;
}

//----------------------------------------------------------------------------------------------------------------------
