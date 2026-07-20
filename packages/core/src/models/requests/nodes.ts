//----------------------------------------------------------------------------------------------------------------------
// Node API DTOs
//
// Request/response contracts for the /api/nodes endpoints (requirements.md sec 7). Wire shapes only -- cross-record
// legality (parent-edge ownership, link-to-link, quota) is the regulation engine's job, not this boundary's (sec 3.6).
// Dates serialize as ISO strings (common.ts); ids stay strings throughout.
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { DEFAULT_CHILDREN_LIMIT, MAX_CHILDREN_LIMIT } from '../../constants/index.ts';

// Models
import { type Node, nodeTypes } from '../node.ts';
import type { Role } from '../role.ts';
import { roleCodec } from '../schemas/role.ts';

// Requests
import { isoDateTimeCodec } from './common.ts';

//----------------------------------------------------------------------------------------------------------------------
// Create (POST /api/nodes) -- folders and links only. Files never arrive here: they're created by the blob claim/PoP
// flow (blobs.ts), which is the only path that can attach a blobID.
//----------------------------------------------------------------------------------------------------------------------

export const createFolderRequestCodec = z.strictObject({
    type: z.literal('folder'),
    name: z.string().min(1),
    parentID: z.string()
        .nullable()
        .optional()
        .default(null),
});

export type CreateFolderRequest = z.infer<typeof createFolderRequestCodec>;

// name is optional: an unnamed link takes the target's current name at creation time (sec 3.2), resolved server-side
// rather than the client guessing at it.
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

export type CreateLinkRequest = z.infer<typeof createLinkRequestCodec>;

// The actual wire type for POST /api/nodes -- one endpoint, discriminated on `type`, matching the domain nodeCodec's
// own discriminated-union shape.
export const createNodeRequestCodec = z.discriminatedUnion(
    'type',
    [ createFolderRequestCodec, createLinkRequestCodec ]
);

export type CreateNodeRequest = z.infer<typeof createNodeRequestCodec>;

//----------------------------------------------------------------------------------------------------------------------
// Update (PATCH /api/nodes/:id) -- rename and move are independent actions (F2 vs drag-and-drop, sec 8) that share
// one endpoint. RenameRequest and MoveRequest name the two operations; PatchNodeRequest is the body either or both
// arrive in, and rejects an empty patch.
//----------------------------------------------------------------------------------------------------------------------

export const renameRequestCodec = z.strictObject({
    name: z.string().min(1),
});

export type RenameRequest = z.infer<typeof renameRequestCodec>;

export const moveRequestCodec = z.strictObject({
    parentID: z.string().nullable(),
});

export type MoveRequest = z.infer<typeof moveRequestCodec>;

export const patchNodeRequestCodec = z.strictObject({
    name: renameRequestCodec.shape.name.optional(),
    parentID: moveRequestCodec.shape.parentID.optional(),
}).refine(
    (patch) => patch.name !== undefined || patch.parentID !== undefined,
    { message: 'A patch must rename, move, or both -- an empty patch is not a request.' }
);

export type PatchNodeRequest = z.infer<typeof patchNodeRequestCodec>;

//----------------------------------------------------------------------------------------------------------------------
// Children listing (GET /api/nodes/:id/children) -- pagination + the sort-key vocabulary (sec 7/8). Query strings
// arrive as strings, so limit/offset are coerced; an over-max limit is rejected rather than silently clamped, matching
// the strict-schema convention elsewhere in core (sec 3.6).
//----------------------------------------------------------------------------------------------------------------------

export const nodeSortKeys = [ 'name', 'size', 'createdAt', 'updatedAt' ] as const;
export type NodeSortKey = typeof nodeSortKeys[number];

export const sortDirections = [ 'asc', 'desc' ] as const;
export type SortDirection = typeof sortDirections[number];

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
});

export type ChildrenQuery = z.infer<typeof childrenQueryCodec>;

//----------------------------------------------------------------------------------------------------------------------
// Responses -- the domain Node shape (models/node.ts) plus the caller's effective role, which rides on every
// node-returning endpoint (sec 7), and ISO-string dates. This is the one place a Node's Date fields get serialized
// for the wire; every other response DTO with a timestamp reuses isoDateTimeCodec rather than re-deriving the format.
//----------------------------------------------------------------------------------------------------------------------

// A link's resolved target, for display (sec 3.2): enough of the target to render its name and type, plus size and mime
// type when it is a file. null when the caller cannot resolve the target -- the row is gone, or access was lost -- in
// which case the client renders the link as a stub (sec 3.2b). No owner or ACL rides here: links conduct no
// permissions, and every resolution re-runs the ACL check as the viewer.
export const linkTargetCodec = z.strictObject({
    id: z.string(),
    type: z.enum(nodeTypes),
    name: z.string(),
    mimeType: z.string().optional(),
    size: z.number().optional(),
});

export type LinkTarget = z.infer<typeof linkTargetCodec>;

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

export type NodeResponse = z.infer<typeof nodeResponseCodec>;

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
});

export type NodeListResponse = z.infer<typeof nodeListResponseCodec>;

//----------------------------------------------------------------------------------------------------------------------
// Serialization -- the single domain Node -> wire NodeResponse crossing. Every node-returning endpoint routes through
// here so a Node's Date fields become ISO strings in exactly one place (isoDateTimeCodec's format) and the effective
// role is attached uniformly (sec 7). `target` is the link's already-resolved target node, or null when unresolvable;
// it is ignored for files and folders.
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
