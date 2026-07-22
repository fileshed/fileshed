//----------------------------------------------------------------------------------------------------------------------
// API Error
//
// The typed failure the resource-access fetch wrappers throw on any non-2xx response: the HTTP status plus the server's
// error message (every route answers with a `{ error }` body via the server's error mapping), with the parsed body
// retained for callers that need the structured detail later. A regulation rejection (403/422) additionally carries
// the stable `violations` codes as a RegulationApiError, so a store branches on a code, not a human message.
//----------------------------------------------------------------------------------------------------------------------

import type { RegulationCode, RegulationViolation } from '@fileshed/core';

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

//----------------------------------------------------------------------------------------------------------------------

// The typed error from an already-parsed error body: the server's `{ error }` message with the HTTP status, upgraded to
// a RegulationApiError when the body carries regulation violation codes. The transport that read the body is irrelevant
// -- fetch hands it a parsed Response body, the XHR upload hands it a parsed responseText -- so both funnel here rather
// than each re-deriving the message and violation mapping.
export function apiErrorFromBody(status : number, statusText : string, body : unknown) : ApiError
{
    const message = errorMessageOf(body) ?? (statusText || `Request failed with status ${ status }`);

    const violations = regulationViolationsOf(body);
    if(violations !== null) { return new RegulationApiError(status, message, violations, body); }

    return new ApiError(status, message, body);
}

// The typed error for a fetch Response the request wrappers rejected.
export async function apiErrorFromResponse(response : Response) : Promise<ApiError>
{
    const body : unknown = await response.json().catch(() => null);

    return apiErrorFromBody(response.status, response.statusText, body);
}

//----------------------------------------------------------------------------------------------------------------------
