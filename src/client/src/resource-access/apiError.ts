//----------------------------------------------------------------------------------------------------------------------
// API Error
//
// The typed failure the resource-access fetch wrappers throw on any non-2xx response: the HTTP status plus the server's
// error message (every route answers with a `{ error }` body via the server's error mapping), with the parsed body
// retained for callers that need the structured detail later (e.g. regulation violations).
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

    static async fromResponse(response : Response) : Promise<ApiError>
    {
        const body : unknown = await response.json().catch(() => null);
        const message = errorMessageOf(body)
            ?? (response.statusText || `Request failed with status ${ response.status }`);

        return new ApiError(response.status, message, body);
    }
}

//----------------------------------------------------------------------------------------------------------------------
