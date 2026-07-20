//----------------------------------------------------------------------------------------------------------------------
// Manager Error HTTP Mapping
//
// The single translation from the shared error vocabulary (@fileshed/core) to a wire status + our JSON error shape.
// app.ts's onError and the specs' composed apps both route through mapManagerError so the mapping lives in exactly one
// place; the error classes themselves are portable and live in core. An unrecognized error returns undefined and the
// caller falls back to a logged 500.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    PayloadTooLargeError,
    type RegulationCode,
    RegulationError,
    type RegulationViolation,
    TooManyRequestsError,
    UnauthorizedError,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// Regulation codes that are authorization failures rather than malformed intent: the caller understood the request but
// lacks the authority to place, link, or trash here. These map to 403; every other code is a legal-request-but-illegal-
// state rejection -> 422.
const authorizationCodes : ReadonlySet<RegulationCode> = new Set<RegulationCode>([
    'parent.crossOwner',
    'link.noAccess',
    'trash.notOwner',
]);

export function regulationHttpStatus(violations : readonly RegulationViolation[]) : 403 | 422
{
    return violations.some((violation) => authorizationCodes.has(violation.code)) ? 403 : 422;
}

export type ErrorStatus = 400 | 401 | 403 | 404 | 413 | 422 | 429;

export interface MappedError
{
    status : ErrorStatus;
    body : { error : string; violations ?: RegulationViolation[] };
}

// The single translation from a manager error to its wire status + body. app.ts's onError and the specs' composed apps
// both route through here so the mapping lives in exactly one place; an unrecognized error returns undefined and the
// caller falls back to a logged 500.
export function mapManagerError(error : unknown) : MappedError | undefined
{
    if(error instanceof UnauthorizedError) { return { status: 401, body: { error: error.message } }; }
    if(error instanceof ForbiddenError) { return { status: 403, body: { error: error.message } }; }
    if(error instanceof NotFoundError) { return { status: 404, body: { error: error.message } }; }
    if(error instanceof BadRequestError) { return { status: 400, body: { error: error.message } }; }
    if(error instanceof PayloadTooLargeError) { return { status: 413, body: { error: error.message } }; }
    if(error instanceof TooManyRequestsError) { return { status: 429, body: { error: error.message } }; }

    if(error instanceof RegulationError)
    {
        return {
            status: regulationHttpStatus(error.violations),
            body: { error: error.message, violations: error.violations },
        };
    }

    return undefined;
}

//----------------------------------------------------------------------------------------------------------------------
