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

// The upload exceeds the configured byte ceiling.
export class PayloadTooLargeError extends Error
{
    constructor(message : string)
    {
        super(message);
        this.name = 'PayloadTooLargeError';
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
    | 'move.intoSelf'
    | 'move.intoDescendant'
    | 'trash.linkNotTrashable'
    | 'trash.notOwner'
    | 'share.linkNotShareable'
    | 'share.notOwner'
    | 'share.granteeIsOwner'
    | 'shareRequest.notPending'
    | 'shareRequest.notOwner'
    | 'quota.exceeded';

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
