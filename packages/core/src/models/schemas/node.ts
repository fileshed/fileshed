//----------------------------------------------------------------------------------------------------------------------
// Node Codec
//
// Zod boundary validator for the Node domain type (models/node.ts). Each variant is a strict object, so a field that
// doesn't belong to that variant (a folder's size or mimeType, a link's blobID or trashedAt) fails validation instead
// of being silently stripped -- the "type-specific fields" invariant holds at parse time, not just at the type level.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import type { Node } from '../node.ts';

//----------------------------------------------------------------------------------------------------------------------

const nodeBaseShape = {
    id: z.string(),
    name: z.string(),
    ownerID: z.string(),
    parentID: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
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

export function parseNode(data : unknown) : Node
{
    return nodeCodec.parse(data);
}

//----------------------------------------------------------------------------------------------------------------------
