//----------------------------------------------------------------------------------------------------------------------
// Node API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { DEFAULT_CHILDREN_LIMIT, MAX_CHILDREN_LIMIT } from '../../../constants/index.ts';

// Models
import { type Node, nodeTypes } from '../../node.ts';
import type { Role } from '../../role.ts';
import { roleCodec } from '../../schemas/role.ts';

// Requests
import {
    type ChildrenQuery,
    type CopyNodeRequest,
    type CreateFolderRequest,
    type CreateLinkRequest,
    type CreateNodeRequest,
    type DeleteNodeQuery,
    type LinkTarget,
    type MoveRequest,
    type NodeListResponse,
    type NodeResponse,
    type PatchNodeRequest,
    type PurgeBrokenLinksResponse,
    type RenameRequest,
    type UserSummary,
    nodeSortKeys,
    nodeTypeFamilies,
    sortDirections,
} from '../nodes.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const createFolderRequestCodec = z.strictObject({
    type: z.literal('folder'),
    name: z.string().min(1),
    parentID: z.string()
        .nullable()
        .optional()
        .default(null),
});

typeAssert<Equals<z.output<typeof createFolderRequestCodec>, CreateFolderRequest>>();

export const createLinkRequestCodec = z.strictObject({
    type: z.literal('link'),
    name: z.string()
        .min(1)
        .optional(),
    parentID: z.string()
        .nullable()
        .optional()
        .default(null),
    targetNodeID: z.string(),
});

typeAssert<Equals<z.output<typeof createLinkRequestCodec>, CreateLinkRequest>>();

export const createNodeRequestCodec = z.discriminatedUnion(
    'type',
    [ createFolderRequestCodec, createLinkRequestCodec ]
);

typeAssert<Equals<z.output<typeof createNodeRequestCodec>, CreateNodeRequest>>();

//----------------------------------------------------------------------------------------------------------------------

export const renameRequestCodec = z.strictObject({
    name: z.string().min(1),
});

typeAssert<Equals<z.output<typeof renameRequestCodec>, RenameRequest>>();

export const moveRequestCodec = z.strictObject({
    parentID: z.string().nullable(),
});

typeAssert<Equals<z.output<typeof moveRequestCodec>, MoveRequest>>();

// The patch rejects an empty body: a request that neither renames nor moves is not a request.
export const patchNodeRequestCodec = z.strictObject({
    name: renameRequestCodec.shape.name.optional(),
    parentID: moveRequestCodec.shape.parentID.optional(),
}).refine(
    (patch) => patch.name !== undefined || patch.parentID !== undefined,
    { message: 'A patch must rename, move, or both -- an empty patch is not a request.' }
);

typeAssert<Equals<z.output<typeof patchNodeRequestCodec>, PatchNodeRequest>>();

//----------------------------------------------------------------------------------------------------------------------

export const copyNodeRequestCodec = z.strictObject({
    parentID: z.string()
        .nullable()
        .optional()
        .default(null),
    name: z.string()
        .min(1)
        .optional(),
});

typeAssert<Equals<z.output<typeof copyNodeRequestCodec>, CopyNodeRequest>>();

export const deleteNodeQueryCodec = z.strictObject({
    offerCopies: z.stringbool()
        .default(false),
});

typeAssert<Equals<z.output<typeof deleteNodeQueryCodec>, DeleteNodeQuery>>();

export const purgeBrokenLinksResponseCodec = z.strictObject({
    purged: z.number()
        .int()
        .nonnegative(),
});

typeAssert<Equals<z.output<typeof purgeBrokenLinksResponseCodec>, PurgeBrokenLinksResponse>>();

//----------------------------------------------------------------------------------------------------------------------
// Query strings arrive as strings, so limit/offset are coerced; an over-max limit is rejected rather than silently
// clamped, matching the strict-schema convention elsewhere in core. The type families ride a single comma-separated
// param ("images,pdfs") -- absent or empty yields an empty selection (unfiltered); any token outside the vocabulary is
// rejected. The date bounds are full ISO instants.
//----------------------------------------------------------------------------------------------------------------------

const typeFamiliesParam = z.string()
    .optional()
    .transform((value) =>
    {
        if(value === undefined || value === '') { return []; }
        return value.split(',');
    })
    .pipe(z.array(z.enum(nodeTypeFamilies)));

export const childrenQueryCodec = z.strictObject({
    limit: z.coerce.number()
        .int()
        .min(1)
        .max(MAX_CHILDREN_LIMIT)
        .default(DEFAULT_CHILDREN_LIMIT),
    offset: z.coerce.number()
        .int()
        .min(0)
        .default(0),
    sortKey: z.enum(nodeSortKeys).default('name'),
    sortDirection: z.enum(sortDirections).default('asc'),
    types: typeFamiliesParam,
    ownerID: z.string().optional(),
    name: z.string()
        .min(1)
        .optional(),
    updatedAfter: z.iso.datetime().optional(),
    updatedBefore: z.iso.datetime().optional(),
});

typeAssert<Equals<z.output<typeof childrenQueryCodec>, ChildrenQuery>>();

//----------------------------------------------------------------------------------------------------------------------
// The response codecs serialize a Node's Date fields to ISO strings (isoDateTimeCodec) in one place and attach the
// caller's effective role.
//----------------------------------------------------------------------------------------------------------------------

export const linkTargetCodec = z.strictObject({
    id: z.string(),
    type: z.enum(nodeTypes),
    name: z.string(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
});

typeAssert<Equals<z.output<typeof linkTargetCodec>, LinkTarget>>();

const nodeResponseBaseShape = {
    id: z.string(),
    name: z.string(),
    ownerID: z.string(),
    parentID: z.string().nullable(),
    createdAt: isoDateTimeCodec,
    updatedAt: isoDateTimeCodec,
    role: roleCodec,
};

const fileNodeResponseCodec = z.strictObject({
    ...nodeResponseBaseShape,
    type: z.literal('file'),
    blobID: z.string(),
    size: z.number(),
    mimeType: z.string(),
    trashedAt: isoDateTimeCodec.nullable(),
});

const folderNodeResponseCodec = z.strictObject({
    ...nodeResponseBaseShape,
    type: z.literal('folder'),
    trashedAt: isoDateTimeCodec.nullable(),
});

const linkNodeResponseCodec = z.strictObject({
    ...nodeResponseBaseShape,
    type: z.literal('link'),
    targetNodeID: z.string(),
    target: linkTargetCodec.nullable(),
});

export const nodeResponseCodec = z.discriminatedUnion(
    'type',
    [ fileNodeResponseCodec, folderNodeResponseCodec, linkNodeResponseCodec ]
);

typeAssert<Equals<z.output<typeof nodeResponseCodec>, NodeResponse>>();

export const userSummaryCodec = z.strictObject({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
});

typeAssert<Equals<z.output<typeof userSummaryCodec>, UserSummary>>();

export const nodeListResponseCodec = z.strictObject({
    nodes: z.array(nodeResponseCodec),
    total: z.number()
        .int()
        .nonnegative(),
    limit: z.number()
        .int()
        .positive(),
    offset: z.number()
        .int()
        .nonnegative(),
    owners: z.array(userSummaryCodec),
});

typeAssert<Equals<z.output<typeof nodeListResponseCodec>, NodeListResponse>>();

//----------------------------------------------------------------------------------------------------------------------
// Serialization -- the single domain Node -> wire NodeResponse crossing. Every node-returning endpoint routes through
// here so a Node's Date fields become ISO strings in exactly one place and the effective role is attached uniformly.
// `target` is the link's already-resolved target node, or null when unresolvable; it is ignored otherwise.
//----------------------------------------------------------------------------------------------------------------------

function linkTargetOf(target : Node | null) : LinkTarget | null
{
    if(target === null) { return null; }

    if(target.type === 'file')
    {
        return { id: target.id, type: 'file', name: target.name, mimeType: target.mimeType, size: target.size };
    }

    return { id: target.id, type: target.type, name: target.name };
}

export function toNodeResponse(node : Node, role : Role, target : Node | null = null) : NodeResponse
{
    const base = {
        id: node.id,
        name: node.name,
        ownerID: node.ownerID,
        parentID: node.parentID,
        createdAt: node.createdAt.toISOString(),
        updatedAt: node.updatedAt.toISOString(),
        role,
    };

    switch (node.type)
    {
        case 'file':
            return {
                ...base,
                type: 'file',
                blobID: node.blobID,
                size: node.size,
                mimeType: node.mimeType,
                trashedAt: node.trashedAt === null ? null : node.trashedAt.toISOString(),
            };

        case 'folder':
            return {
                ...base,
                type: 'folder',
                trashedAt: node.trashedAt === null ? null : node.trashedAt.toISOString(),
            };

        case 'link':
            return {
                ...base,
                type: 'link',
                targetNodeID: node.targetNodeID,
                target: linkTargetOf(target),
            };
    }
}

//----------------------------------------------------------------------------------------------------------------------
