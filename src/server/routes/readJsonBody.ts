//----------------------------------------------------------------------------------------------------------------------
// JSON Body Reader
//
// The one JSON-body-to-DTO crossing every mutating route shares: parse the body, validate it against the endpoint's
// codec, and raise a typed BadRequestError on either failure -- ctx.req.json throws a SyntaxError on malformed input,
// which would otherwise fall through to a 500 rather than the 400 a bad request deserves. Routes carry no error-shape
// logic of their own; onError maps the typed error (managers/errors.ts).
//----------------------------------------------------------------------------------------------------------------------

import type { Context } from 'hono';
import type { ZodType } from 'zod';

// Models
import { BadRequestError } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export async function readJsonBody<T>(ctx : Context, codec : ZodType<T>) : Promise<T>
{
    let raw : unknown;
    try { raw = await ctx.req.json(); }
    catch { throw new BadRequestError('Request body must be valid JSON.'); }

    const result = codec.safeParse(raw);
    if(!result.success) { throw new BadRequestError('The request body does not match the expected shape.'); }

    return result.data;
}

//----------------------------------------------------------------------------------------------------------------------
