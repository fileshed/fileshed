//----------------------------------------------------------------------------------------------------------------------
// Query String Parser
//
// The one query-string-to-DTO crossing the read routes share: validate ctx.req.query() against the endpoint's codec
// and raise a typed BadRequestError on a shape mismatch. Routes carry no error-shape logic of their own; onError maps
// the typed error (managers/errors.ts).
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
