//----------------------------------------------------------------------------------------------------------------------
// Query String Parser
//----------------------------------------------------------------------------------------------------------------------

import type { Context } from 'hono';
import type { ZodType } from 'zod';

// Models
import { BadRequestError } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export function parseQuery<T>(ctx : Context, codec : ZodType<T>) : T
{
    const result = codec.safeParse(ctx.req.query());
    if(!result.success) { throw new BadRequestError('The query parameters are invalid.'); }

    return result.data;
}

//----------------------------------------------------------------------------------------------------------------------
