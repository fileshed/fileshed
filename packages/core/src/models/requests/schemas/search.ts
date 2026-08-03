//----------------------------------------------------------------------------------------------------------------------
// Search API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from '../../../constants/index.ts';

// Requests
import type { LocationCrumb, NodeLocation, SearchQuery, SearchResponse } from '../search.ts';

// Request Schemas
import { nodeListResponseCodec } from './nodes.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

// q is trimmed then required non-empty, so a blank or whitespace-only query is a 400 rather than a match-everything
// scan. Query strings arrive as strings, so limit/offset are coerced; an over-max limit is rejected, not clamped,
// matching the children query.
export const searchQueryCodec = z.strictObject({
    q: z.string()
        .trim()
        .min(1),
    limit: z.coerce.number()
        .int()
        .min(1)
        .max(MAX_SEARCH_LIMIT)
        .default(DEFAULT_SEARCH_LIMIT),
    offset: z.coerce.number()
        .int()
        .min(0)
        .default(0),
});

typeAssert<Equals<z.output<typeof searchQueryCodec>, SearchQuery>>();

//----------------------------------------------------------------------------------------------------------------------

export const locationCrumbCodec = z.strictObject({
    id: z.string(),
    name: z.string(),
});

typeAssert<Equals<z.output<typeof locationCrumbCodec>, LocationCrumb>>();

export const nodeLocationCodec = z.strictObject({
    crumbs: z.array(locationCrumbCodec),
    foreign: z.boolean(),
});

typeAssert<Equals<z.output<typeof nodeLocationCodec>, NodeLocation>>();

// The search envelope is the ordinary node listing plus the locations sidecar, composed off the listing codec's shape
// so the two can never drift apart.
export const searchResponseCodec = z.strictObject({
    ...nodeListResponseCodec.shape,
    locations: z.record(z.string(), nodeLocationCodec),
});

typeAssert<Equals<z.output<typeof searchResponseCodec>, SearchResponse>>();

//----------------------------------------------------------------------------------------------------------------------
