//----------------------------------------------------------------------------------------------------------------------
// Node API DTOs
//
// Request/response contracts for the /api/nodes endpoints. Wire shapes only -- cross-record legality (parent-edge
// ownership, link-to-link, quota) is the regulation engine's job, not this boundary's. Dates serialize as ISO strings;
// ids stay strings throughout.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { NodeType } from '../node.ts';
import type { Role } from '../role.ts';

//----------------------------------------------------------------------------------------------------------------------
// Create (POST /api/nodes) -- folders and links only. Files never arrive here: they're created by the blob claim/PoP
// flow (blobs), which is the only path that can attach a blobID.
//----------------------------------------------------------------------------------------------------------------------

export interface CreateFolderRequest
{
    type : 'folder';
    name : string;
    parentID : string | null;
}

// name is optional: an unnamed link takes the target's current name at creation time, resolved server-side
// rather than the client guessing at it.
export interface CreateLinkRequest
{
    type : 'link';
    name ?: string;
    parentID : string | null;
    targetNodeID : string;
}

// The wire type for POST /api/nodes -- one endpoint, discriminated on `type`, mirroring the domain Node's own shape.
export type CreateNodeRequest = CreateFolderRequest | CreateLinkRequest;

//----------------------------------------------------------------------------------------------------------------------
// Update (PATCH /api/nodes/:id) -- rename and move are independent actions (F2 vs drag-and-drop) that share one
// endpoint. RenameRequest and MoveRequest name the two operations; PatchNodeRequest is the body either or both arrive
// in.
//----------------------------------------------------------------------------------------------------------------------

export interface RenameRequest
{
    name : string;
}

export interface MoveRequest
{
    parentID : string | null;
}

export interface PatchNodeRequest
{
    name ?: string;
    parentID ?: string | null;
}

//----------------------------------------------------------------------------------------------------------------------
// Copy (POST /api/nodes/:id/copy) -- save a file shared to you (or your own) as a new node you own, referencing the
// same blob. name is optional: an unnamed copy takes the source's current name, resolved server-side. parentID null
// lands the copy in the caller's root.
//----------------------------------------------------------------------------------------------------------------------

export interface CopyNodeRequest
{
    parentID : string | null;
    name ?: string;
}

//----------------------------------------------------------------------------------------------------------------------
// Delete (DELETE /api/nodes/:id) -- the recipients-may-copy opt-in rides the query string, since DELETE bodies are
// stripped by enough intermediaries to be unreliable. Absent means delete for everyone, the default.
//----------------------------------------------------------------------------------------------------------------------

export interface DeleteNodeQuery
{
    offerCopies : boolean;
}

//----------------------------------------------------------------------------------------------------------------------
// Children listing (GET /api/nodes/:id/children) -- pagination plus the sort-key vocabulary.
//----------------------------------------------------------------------------------------------------------------------

export const nodeSortKeys = [ 'name', 'size', 'createdAt', 'updatedAt' ] as const;
export type NodeSortKey = typeof nodeSortKeys[number];

export const sortDirections = [ 'asc', 'desc' ] as const;
export type SortDirection = typeof sortDirections[number];

export interface ChildrenQuery
{
    limit : number;
    offset : number;
    sortKey : NodeSortKey;
    sortDirection : SortDirection;
}

//----------------------------------------------------------------------------------------------------------------------
// Responses -- the domain Node shape (models/node.ts) plus the caller's effective role, which rides on every
// node-returning endpoint, and ISO-string dates.
//----------------------------------------------------------------------------------------------------------------------

// A link's resolved target, for display: enough of the target to render its name and type, plus size and mime
// type when it is a file. null when the caller cannot resolve the target -- the row is gone, or access was lost -- in
// which case the client renders the link as a stub. No owner or ACL rides here: links conduct no
// permissions, and every resolution re-runs the ACL check as the viewer.
export interface LinkTarget
{
    id : string;
    type : NodeType;
    name : string;
    mimeType ?: string;
    size ?: number;
}

interface NodeResponseBase
{
    id : string;
    name : string;
    ownerID : string;
    parentID : string | null;
    createdAt : string;
    updatedAt : string;
    role : Role;
}

interface FileNodeResponse extends NodeResponseBase
{
    type : 'file';
    blobID : string;
    size : number;
    mimeType : string;
    trashedAt : string | null;
}

interface FolderNodeResponse extends NodeResponseBase
{
    type : 'folder';
    trashedAt : string | null;
}

interface LinkNodeResponse extends NodeResponseBase
{
    type : 'link';
    targetNodeID : string;
    target : LinkTarget | null;
}

export type NodeResponse = FileNodeResponse | FolderNodeResponse | LinkNodeResponse;

export interface NodeListResponse
{
    nodes : NodeResponse[];
    total : number;
    limit : number;
    offset : number;
}

//----------------------------------------------------------------------------------------------------------------------
