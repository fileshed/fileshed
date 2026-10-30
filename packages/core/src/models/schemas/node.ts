//----------------------------------------------------------------------------------------------------------------------
// Node Codec
//
// Each variant is a strict object, so a field that doesn't belong to that variant (a folder's size or mimeType, a
// link's blobID or trashedAt) fails validation instead of being silently stripped.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { Node } from '../node.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

const nodeBaseShape = {
    id: z.string(),
    name: z.string(),
    ownerID: z.string(),
    parentID: z.string().nullable(),
    created: z.date(),
    updated: z.date(),
};

//----------------------------------------------------------------------------------------------------------------------
// Type Variants
//----------------------------------------------------------------------------------------------------------------------

const fileNodeCodec = z.strictObject({
    ...nodeBaseShape,
    type: z.literal('file'),
    blobID: z.string(),
    size: z.number(),
    mimeType: z.string(),
    trashedAt: z.date().nullable(),
});

const folderNodeCodec = z.strictObject({
    ...nodeBaseShape,
    type: z.literal('folder'),
    trashedAt: z.date().nullable(),
});

const linkNodeCodec = z.strictObject({
    ...nodeBaseShape,
    type: z.literal('link'),
    targetNodeID: z.string(),
});

//----------------------------------------------------------------------------------------------------------------------

export const nodeCodec = z.discriminatedUnion('type', [ fileNodeCodec, folderNodeCodec, linkNodeCodec ]);

typeAssert<Equals<z.output<typeof nodeCodec>, Node>>();

export function parseNode(data : unknown) : Node
{
    return nodeCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
