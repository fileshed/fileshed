//----------------------------------------------------------------------------------------------------------------------
// Shared Error Vocabulary
//
// Every typed error the client and server branch on, in one place. These are plain, portable classes -- no Node or
// framework imports may enter this file -- so both packages throw and recognise the same errors. The HTTP status each
// maps to is the server's transport concern (src/server/managers/errors.ts), not encoded here; what is encoded here is
// the stable `code` strings and violation vocabulary, which ARE the wire contract.
//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------
// Request-shaped errors
//----------------------------------------------------------------------------------------------------------------------

// A caller has no valid session.
export class UnauthorizedError extends Error
{
    constructor(message : string)
    {
        super(message);
        this.name = 'UnauthorizedError';
    }
}

// A caller authenticated but lacks the authority for this operation.
export class ForbiddenError extends Error
{
    constructor(message : string)
    {
        super(message);
        this.name = 'ForbiddenError';
    }
}

// The request itself is malformed for this operation. Distinct from a codec shape rejection: this is a semantic
// mismatch the codecs can't see (the streamed bytes disagree with the claimed hash/size, a declared Content-Length that
// contradicts the claim).
export class BadRequestError extends Error
{
    constructor(message : string)
    {
        super(message);
        this.name = 'BadRequestError';
    }
}

// The addressed resource does not exist (or no longer does: a consumed or expired single-use ticket/challenge).
export class NotFoundError extends Error
{
    constructor(message : string)
    {
        super(message);
        this.name = 'NotFoundError';
    }
}

// The upload exceeds the configured byte ceiling. The ceiling travels with the refusal: it is a live setting, so the
// only number that describes why this upload was refused is the one the check just read, and a caller told "too large"
// without it has nothing to show the person who picked the file.
export class PayloadTooLargeError extends Error
{
    readonly maxBytes : number;

    constructor(message : string, maxBytes : number)
    {
        super(message);
        this.name = 'PayloadTooLargeError';
        this.maxBytes = maxBytes;
    }
}

// The caller has tripped a per-user rate limit (a run of failed proofs is someone probing hashes they don't hold).
export class TooManyRequestsError extends Error
{
    constructor(message : string)
    {
        super(message);
        this.name = 'TooManyRequestsError';
    }
}

// Which collision a conflict reports. Two of them pass on their own: `upload.chunkInFlight` while the server unwinds
// the request that held the ticket, and `sweep.alreadyRunning` until the sweep in progress finishes -- in both cases
// the same request sent again later lands. The rest are settled, and repeating the request repeats the refusal until
// the caller changes what it sends.
export const conflictCodes = [
    'upload.chunkInFlight',
    'upload.offsetConflict',
    'replace.staleBlob',
    'sweep.alreadyRunning',
] as const;

export type ConflictCode = typeof conflictCodes[number];

// Two writes to the same thing collided. The code, not the message, is what a caller branches on.
export class ConflictError extends Error
{
    readonly code : ConflictCode;

    constructor(code : ConflictCode, message : string)
    {
        super(message);
        this.name = 'ConflictError';
        this.code = code;
    }
}

// A chunk that claimed ground the upload has already covered, or ground it has not reached yet. The position the
// upload actually holds travels with the refusal: it is the only thing that tells the client where to start sending
// instead, and a client that had to read it out of the message would be parsing English to resume an upload.
export class OffsetConflictError extends ConflictError
{
    readonly receivedBytes : number;

    constructor(message : string, receivedBytes : number)
    {
        super('upload.offsetConflict', message);
        this.name = 'OffsetConflictError';
        this.receivedBytes = receivedBytes;
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Regulation
//
// The typed result of a legality judgement. A code is stable and machine-readable so managers and clients can branch on
// it without parsing the human message. The engine returns violations; a manager turns them into a RegulationError.
//----------------------------------------------------------------------------------------------------------------------

export type RegulationCode
    = | 'link.targetIsLink'
    | 'link.selfTarget'
    | 'link.noAccess'
    | 'parent.notFolder'
    | 'parent.trashed'
    | 'parent.crossOwner'
    | 'parent.tooDeep'
    | 'move.intoSelf'
    | 'move.intoDescendant'
    | 'trash.linkNotTrashable'
    | 'trash.notOwner'
    | 'copy.sourceNotFile'
    | 'replace.notFile'
    | 'replace.notEditor'
    | 'share.linkNotShareable'
    | 'share.notOwner'
    | 'share.granteeIsOwner'
    | 'shareRequest.notPending'
    | 'shareRequest.notOwner'
    | 'quota.exceeded';

// The human-readable line shown for each regulation code -- the display vocabulary that travels with the code, so a
// client renders a rejection off the stable code rather than parsing its raw message. The Record is total: a new code
// can't ship without its copy.
export const RegulationCodeDisplay : Record<RegulationCode, string> = {
    'link.targetIsLink': 'You can\'t create a link to another link.',
    'link.selfTarget': 'You can\'t create a link to itself.',
    'link.noAccess': 'You no longer have access to that item.',
    'parent.notFolder': 'That destination isn\'t a folder.',
    'parent.trashed': 'That destination is in the trash.',
    'parent.crossOwner': 'You can only move items into a folder you own.',
    'parent.tooDeep': 'That destination is nested as deep as folders go.',
    'move.intoSelf': 'You can\'t move a folder into itself.',
    'move.intoDescendant': 'You can\'t move a folder into one of its own subfolders.',
    'trash.linkNotTrashable': 'Links are removed, not trashed.',
    'trash.notOwner': 'You can only trash items you own.',
    'copy.sourceNotFile': 'Only files can be copied.',
    'replace.notFile': 'Only a file\'s contents can be replaced.',
    'replace.notEditor': 'You need edit access to replace this file\'s contents.',
    'share.linkNotShareable': 'Links can\'t be shared.',
    'share.notOwner': 'You can only share items you own.',
    'share.granteeIsOwner': 'You can\'t share an item with its own owner.',
    'shareRequest.notPending': 'That share request has already been handled.',
    'shareRequest.notOwner': 'You can only respond to share requests for items you own.',
    'quota.exceeded': 'This would put you over your storage quota.',
};

export interface RegulationViolation
{
    code : RegulationCode;
    message : string;
    nodeID ?: string;
    parentID ?: string;
    targetNodeID ?: string;
    actorID ?: string;
    ownerID ?: string;
    granteeID ?: string;
    requestID ?: string;
}

// One or more regulation violations blocked a mutation. Carries the typed violations so the client receives their
// stable codes, not just a message.
export class RegulationError extends Error
{
    readonly violations : RegulationViolation[];

    constructor(violations : RegulationViolation[])
    {
        super(violations[0]?.message ?? 'The request violates a placement rule.');
        this.name = 'RegulationError';
        this.violations = violations;
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Blob backend errors
//
// Stable, machine-readable codes so a consuming manager can branch on the failure without parsing the message. The put
// integrity failures (hash/size mismatch) and the lookup miss (not found) are the surface backends promise;
// invalidSha256 guards the address before it reaches the filesystem, since a backend may derive a path from it.
//----------------------------------------------------------------------------------------------------------------------

export type BlobBackendErrorCode
    = | 'blob.notFound'
    | 'blob.hashMismatch'
    | 'blob.sizeMismatch'
    | 'blob.invalidSha256';

export class BlobBackendError extends Error
{
    readonly code : BlobBackendErrorCode;

    constructor(code : BlobBackendErrorCode, message : string)
    {
        super(message);
        this.name = 'BlobBackendError';
        this.code = code;
    }
}

// Nothing is stored under this sha256.
export class BlobNotFoundError extends BlobBackendError
{
    readonly sha256 : string;

    constructor(sha256 : string)
    {
        super('blob.notFound', `no blob stored for sha256 ${ sha256 }`);
        this.name = 'BlobNotFoundError';
        this.sha256 = sha256;
    }
}

// The streamed bytes hashed to something other than the claimed sha256.
export class HashMismatchError extends BlobBackendError
{
    readonly expected : string;
    readonly actual : string;

    constructor(expected : string, actual : string)
    {
        super('blob.hashMismatch', `sha256 mismatch: claimed ${ expected }, computed ${ actual }`);
        this.name = 'HashMismatchError';
        this.expected = expected;
        this.actual = actual;
    }
}

// The streamed byte count differed from the claimed size.
export class SizeMismatchError extends BlobBackendError
{
    readonly sha256 : string;
    readonly expected : number;
    readonly actual : number;

    constructor(sha256 : string, expected : number, actual : number)
    {
        super('blob.sizeMismatch', `size mismatch for ${ sha256 }: claimed ${ expected }, received ${ actual }`);
        this.name = 'SizeMismatchError';
        this.sha256 = sha256;
        this.expected = expected;
        this.actual = actual;
    }
}

// The address is not a well-formed sha256 digest, so no path may be derived from it.
export class InvalidSha256Error extends BlobBackendError
{
    readonly sha256 : string;

    constructor(sha256 : string)
    {
        super('blob.invalidSha256', `not a valid sha256 digest: ${ sha256 }`);
        this.name = 'InvalidSha256Error';
        this.sha256 = sha256;
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Blob backend resolution errors
//----------------------------------------------------------------------------------------------------------------------

// A blob record points at a backend id with no storage_backend row -- the RESTRICT FK should prevent it, so seeing it
// means the row was deleted out from under a live record.
export class BackendNotFoundError extends Error
{
    readonly backendID : string;

    constructor(backendID : string)
    {
        super(`no storage backend configured for id ${ backendID }`);
        this.name = 'BackendNotFoundError';
        this.backendID = backendID;
    }
}

// No backend is marked default, so a write has nowhere to land (one default per deployment).
export class NoDefaultBackendError extends Error
{
    constructor()
    {
        super('no default storage backend is configured');
        this.name = 'NoDefaultBackendError';
    }
}

// The backend row names a kind this build has no facade for (db/s3/azure are schema-admitted but v1 ships fs only).
export class UnsupportedBackendError extends Error
{
    readonly kind : string;

    constructor(kind : string)
    {
        super(`storage backend kind '${ kind }' is not supported by this build`);
        this.name = 'UnsupportedBackendError';
        this.kind = kind;
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Node store corruption
//----------------------------------------------------------------------------------------------------------------------

// A row that contradicts its own type discriminator -- a file without a blob, a link with a size, and so on. The DB
// CHECK constraint keeps this from ever being stored, so seeing one means the store was corrupted out from under us.
export class NodeRowCorruptionError extends Error
{
    constructor(message : string)
    {
        super(message);
        this.name = 'NodeRowCorruptionError';
    }
}

//----------------------------------------------------------------------------------------------------------------------
