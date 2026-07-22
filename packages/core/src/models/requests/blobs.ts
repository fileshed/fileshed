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
// Commit metadata for both commit paths (a completed upload or an answered challenge). Two mutually exclusive modes:
// CREATE mints a brand-new file node from name/parent/mimeType; REPLACE overwrites the content of an existing file
// node in place. Saving an edited file and an upload-collision "Replace" are the same operation -- new bytes onto an
// existing node -- and reusing the node preserves its id, so every link and share pointing at it survives.
//----------------------------------------------------------------------------------------------------------------------

export interface UploadCommitCreate
{
    name : string;
    parentID : string | null;
    mimeType : string;
}

// mimeType is optional in replace mode: an edit save keeps the node's current type, while a collision "Replace" may
// change it. name and parent never travel -- a replace overwrites bytes without moving or renaming the node.
export interface UploadCommitReplace
{
    replaceNodeID : string;
    mimeType ?: string;
}

// Discriminated by which mode's fields are present, not a literal tag: create metadata carries name (and mimeType),
// replace metadata carries replaceNodeID. Supplying both modes or neither is rejected at the codec.
export type UploadCommitMetadata = UploadCommitCreate | UploadCommitReplace;

//----------------------------------------------------------------------------------------------------------------------
// POST /api/blobs/claim/:challengeID -- the HMAC answer plus the commit metadata, since a successful proof commits the
// node in the same round trip and zero bytes are uploaded. The answer rides either commit mode.
//----------------------------------------------------------------------------------------------------------------------

export interface ChallengeAnswerCreate extends UploadCommitCreate
{
    answer : string;
}

export interface ChallengeAnswerReplace extends UploadCommitReplace
{
    answer : string;
}

export type ChallengeAnswerRequest = ChallengeAnswerCreate | ChallengeAnswerReplace;

//----------------------------------------------------------------------------------------------------------------------
