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

// chunkBytes is the size the client cuts the file into, and it rides the ticket because the deployment can override
// the compiled default: the client plans its chunks right after claiming, so the server's number arrives at exactly
// the moment it is needed. A challenge carries none -- a proven blob moves no bytes to size.
interface ClaimTicketResponse
{
    upload : true;
    ticket : string;
    chunkBytes : number;
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
//
// ifBlobID is an optional optimistic-concurrency guard: the blob the caller loaded and edited from. When present, the
// commit is refused (409) if the node's current blob has moved on since -- someone else saved first. Absent, a replace
// is last-write-wins, unchanged.
export interface UploadCommitReplace
{
    replaceNodeID : string;
    mimeType ?: string;
    ifBlobID ?: string;
}

// Discriminated by which mode's fields are present, not a literal tag: create metadata carries name (and mimeType),
// replace metadata carries replaceNodeID. Supplying both modes or neither is rejected at the codec.
export type UploadCommitMetadata = UploadCommitCreate | UploadCommitReplace;

//----------------------------------------------------------------------------------------------------------------------
// PUT /api/uploads/:ticket -- the answer to a chunk that landed without completing the file. The committed node comes
// back only from the chunk that carries the last byte; every earlier one answers with where the upload now stands, so
// a client can show progress against the size it claimed.
//----------------------------------------------------------------------------------------------------------------------

export interface UploadChunkAccepted
{
    receivedBytes : number;
    totalBytes : number;
}

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
