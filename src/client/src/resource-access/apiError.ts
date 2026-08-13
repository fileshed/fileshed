//----------------------------------------------------------------------------------------------------------------------
// API Error
//
// The typed failure the resource-access fetch wrappers throw on any non-2xx response: the HTTP status plus the server's
// error message (every route answers with a `{ error }` body via the server's error mapping), with the parsed body
// retained for callers that need the structured detail later. A regulation rejection (403/422) additionally carries
// the stable `violations` codes as a RegulationApiError, and a conflict (409) its `code` as a ConflictApiError, so a
// store branches on a code, not a human message.
//----------------------------------------------------------------------------------------------------------------------

import type { ConflictCode, RegulationCode, RegulationViolation } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

function errorMessageOf(body : unknown) : string | null
{
    if(typeof body === 'object' && body !== null && 'error' in body)
    {
        const { error } = body as { error : unknown };
        if(typeof error === 'string' && error !== '') { return error; }
    }

    return null;
}

// The violations off a regulation error body, or null when the body carries none. The identity of other users is
// already stripped server-side, so a wire violation is its code, its message, and the resource ids the caller supplied.
// The codes are the contract; the array is accepted structurally rather than re-validated against the code enum, so a
// code the server adds later still reaches a caller instead of failing the whole error.
function regulationViolationsOf(body : unknown) : RegulationViolation[] | null
{
    if(typeof body !== 'object' || body === null || !('violations' in body)) { return null; }

    const { violations } = body as { violations : unknown };
    if(!Array.isArray(violations) || violations.length === 0) { return null; }

    const wellFormed = violations.every((violation) =>
        typeof violation === 'object'
        && violation !== null
        && typeof (violation as { code : unknown }).code === 'string');

    return wellFormed ? (violations as RegulationViolation[]) : null;
}

// The conflict code off a 409 body. The status is read alongside it: `code` is a common enough field name that another
// surface's error body could carry an unrelated one. Like the violation codes, the value is taken as given rather than
// checked against the union, so a code the server adds later still reaches a caller -- one it does not know matches
// none of its branches.
function conflictCodeOf(status : number, body : unknown) : ConflictCode | null
{
    if(status !== 409 || typeof body !== 'object' || body === null || !('code' in body)) { return null; }

    const { code } = body as { code : unknown };

    return typeof code === 'string' ? (code as ConflictCode) : null;
}

// How much of an upload the server holds, off a conflict body. Only an offset conflict carries one, and only a whole,
// non-negative count is one -- the client cuts its next chunk at exactly this byte, so anything else is not a position
// and the conflict keeps its original meaning of "these bytes do not belong here".
function receivedBytesOf(body : unknown) : number | null
{
    if(typeof body !== 'object' || body === null || !('receivedBytes' in body)) { return null; }

    const { receivedBytes } = body as { receivedBytes : unknown };
    if(typeof receivedBytes !== 'number' || !Number.isInteger(receivedBytes) || receivedBytes < 0) { return null; }

    return receivedBytes;
}

//----------------------------------------------------------------------------------------------------------------------

export class ApiError extends Error
{
    readonly status : number;
    readonly body : unknown;

    constructor(status : number, message : string, body ?: unknown)
    {
        super(message);

        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }
}

// A regulation rejection: the request was understood but a legality rule blocked it. The violations carry stable
// codes a caller branches on without parsing the message.
export class RegulationApiError extends ApiError
{
    readonly violations : RegulationViolation[];

    constructor(status : number, message : string, violations : RegulationViolation[], body ?: unknown)
    {
        super(status, message, body);

        this.name = 'RegulationApiError';
        this.violations = violations;
    }

    hasCode(code : RegulationCode) : boolean
    {
        return this.violations.some((violation) => violation.code === code);
    }

    codes() : RegulationCode[]
    {
        return this.violations.map((violation) => violation.code);
    }
}

// A conflict: two writes to the same thing collided. Always a 409, so the status is not the caller's to supply, and
// the code is what separates a caller that must change what it sends from one that need only ask again.
export class ConflictApiError extends ApiError
{
    readonly code : ConflictCode;

    // Where the server says the upload stands, on the conflict that carries it -- an offset conflict is the two sides
    // disagreeing about the position, and this is the server's, which settles it. Null on every other conflict.
    readonly receivedBytes : number | null;

    constructor(message : string, code : ConflictCode, receivedBytes : number | null = null, body ?: unknown)
    {
        super(409, message, body);

        this.name = 'ConflictApiError';
        this.code = code;
        this.receivedBytes = receivedBytes;
    }
}

//----------------------------------------------------------------------------------------------------------------------

// The typed error from an already-parsed error body: the server's `{ error }` message with the HTTP status, upgraded to
// a RegulationApiError when the body carries regulation violation codes and to a ConflictApiError when it carries a
// conflict code. The transport that read the body is irrelevant -- fetch hands it a parsed Response body, the XHR
// upload hands it a parsed responseText -- so both funnel here rather than each re-deriving the message and the codes.
export function apiErrorFromBody(status : number, statusText : string, body : unknown) : ApiError
{
    const message = errorMessageOf(body) ?? (statusText || `Request failed with status ${ status }`);

    const violations = regulationViolationsOf(body);
    if(violations !== null) { return new RegulationApiError(status, message, violations, body); }

    const conflict = conflictCodeOf(status, body);
    if(conflict !== null) { return new ConflictApiError(message, conflict, receivedBytesOf(body), body); }

    return new ApiError(status, message, body);
}

// The typed error for a fetch Response the request wrappers rejected.
export async function apiErrorFromResponse(response : Response) : Promise<ApiError>
{
    const body : unknown = await response.json().catch(() => null);

    return apiErrorFromBody(response.status, response.statusText, body);
}

//----------------------------------------------------------------------------------------------------------------------
