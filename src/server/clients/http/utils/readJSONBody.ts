//----------------------------------------------------------------------------------------------------------------------
// JSON Body Reader
//
// ctx.req.json throws a SyntaxError on malformed input, which would otherwise surface as a 500 rather than the 400 a
// bad request deserves.
//----------------------------------------------------------------------------------------------------------------------

import type { Context } from 'hono';
import type { ZodType } from 'zod';

// Models
import { BadRequestError } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export async function readJSONBody<T>(ctx : Context, codec : ZodType<T>) : Promise<T>
{
    let raw : unknown;
    try { raw = await ctx.req.json(); }
    catch { throw new BadRequestError('Request body must be valid JSON.'); }

    const result = codec.safeParse(raw);
    if(!result.success) { throw new BadRequestError('The request body does not match the expected shape.'); }

    return result.data;
}

//----------------------------------------------------------------------------------------------------------------------
