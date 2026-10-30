//----------------------------------------------------------------------------------------------------------------------
// Error Responses
//----------------------------------------------------------------------------------------------------------------------

// Models
import { AppError, type ErrorDetails, HTTP_STATUS_BY_ERROR_KIND } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export interface ErrorResponse
{
    status : typeof HTTP_STATUS_BY_ERROR_KIND[keyof typeof HTTP_STATUS_BY_ERROR_KIND];
    body : ErrorDetails & { error : string };
    headers ?: Record<string, string>;
}

// Upload-Limit field of the IETF resumable-uploads draft, whose max-size key is a Structured Fields Dictionary member
// holding an Integer. The draft asks a limit-violation rejection to carry the limits it violated, so a client that
// speaks the standard field and one that reads our body arrive at the same number.
function uploadLimitHeaders(details : ErrorDetails) : Record<string, string> | undefined
{
    return details.maxBytes === undefined ? undefined : { 'Upload-Limit': `max-size=${ details.maxBytes }` };
}

// Anything that is not an AppError has no response here; the app's error handler answers it as a server failure.
export function errorToResponse(error : unknown) : ErrorResponse | undefined
{
    if(!(error instanceof AppError)) { return undefined; }

    const { details } = error;

    return {
        status: HTTP_STATUS_BY_ERROR_KIND[error.kind],
        body: { error: error.message, ...details },
        headers: uploadLimitHeaders(details),
    };
}

//----------------------------------------------------------------------------------------------------------------------
