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
// Broken-link cleanup (POST /api/nodes/:id/purge-broken-links) -- the count of the caller's dead links removed from
// the folder. "Dead" is derived at purge time (the caller cannot resolve the link's target), never a stored flag.
//----------------------------------------------------------------------------------------------------------------------

export interface PurgeBrokenLinksResponse
{
    purged : number;
}

//----------------------------------------------------------------------------------------------------------------------
// Empty trash (DELETE /api/trash) -- the count of the caller's own trashed subtree roots permanently purged. Each
// root purges through the same subtree-delete + blob-graveyard path a single permanent delete takes; an already-empty
// trash reports zero rather than erroring.
//----------------------------------------------------------------------------------------------------------------------

export interface EmptyTrashResponse
{
    purged : number;
}

//----------------------------------------------------------------------------------------------------------------------
// Children listing (GET /api/nodes/:id/children) -- pagination, the sort-key vocabulary, and the filter facets.
//----------------------------------------------------------------------------------------------------------------------

export const nodeSortKeys = [ 'name', 'size', 'createdAt', 'updatedAt', 'kind' ] as const;
export type NodeSortKey = typeof nodeSortKeys[number];

export const sortDirections = [ 'asc', 'desc' ] as const;
export type SortDirection = typeof sortDirections[number];

// The curated node-type families a listing can be filtered by. A family is broader than a raw mime type -- 'documents'
// is every text/* type, 'archives' a fixed set of archive mimes (ARCHIVE_MIME_TYPES) -- so the client filters by an
// intent ("images") rather than enumerating mimes. 'folders' and 'links' select by node type; the rest select file
// nodes by mime. Multi-select ORs the chosen families together.
export const nodeTypeFamilies
    = [ 'folders', 'documents', 'pdfs', 'images', 'video', 'playlists', 'audio', 'archives', 'links' ] as const;
export type NodeTypeFamily = typeof nodeTypeFamilies[number];

// The filters ride the query string alongside pagination and sort, AND-combined. `types` is always present (empty =
// unfiltered); ownerID, name, and the date window are absent when their filter is off. The date bounds are ISO
// instants: updatedAfter is an inclusive lower bound, updatedBefore an exclusive upper bound (a half-open window).
// `name` is an EXACT match, not a substring -- it exists so a client can detect an upload name collision correctly
// under pagination (asking "is there already a child named X?" without paging the whole folder).
export interface ChildrenQuery
{
    limit : number;
    offset : number;
    sortKey : NodeSortKey;
    sortDirection : SortDirection;
    types : NodeTypeFamily[];
    ownerID ?: string;
    name ?: string;
    updatedAfter ?: string;
    updatedBefore ?: string;
}

//----------------------------------------------------------------------------------------------------------------------
// Responses -- the domain Node shape (models/node.ts) plus the caller-relative facts that ride on every node-returning
// endpoint (the effective role, what the node currently shares), and ISO-string dates.
//----------------------------------------------------------------------------------------------------------------------

// A link's resolved target, for display: enough of the target to render its name and type, plus size and mime
// type when it is a file. null when the caller cannot resolve the target -- the row is gone, or access was lost -- in
// which case the client renders the link as a stub, falling back to the link node's own ownerID. ownerID names who
// owns the TARGET, not the link -- a link placed via "Add to my files" points at someone else's file, so the Owner
// column must name that someone, not the recipient who placed it. No ACL rides here: links conduct no
// permissions, and every resolution re-runs the ACL check as the viewer -- so disclosing the target's owner
// discloses nothing the viewer couldn't already see by resolving the target directly.
export interface LinkTarget
{
    id : string;
    type : NodeType;
    name : string;
    ownerID : string;
    mimeType ?: string;
    size ?: number;
}

// How far one node currently reaches beyond its owner: how many people hold a grant on it, and the `/d/<token>` path
// of its live public link. Both are derived at read time, never stored, so a revoked grant or link stops counting on
// the very next read.
export interface NodeSharing
{
    granteeCount : number;
    linkUrl : string | null;
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

    // What the node reaches beyond its owner, as far as this caller may see it. The two answers are distinct and both
    // mean something: null is "not yours to know" -- the caller does not own the node, or their access token lacks
    // shares:read -- while a zero count with a null link is the owner's own answer that nothing is granted and nothing
    // is published. A node that currently reaches no one at all reports the zeros without asking: one just created,
    // and one in the trash, whose links serve nothing until it is restored.
    sharing : NodeSharing | null;
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

// A user reduced to what a listing needs to render and filter by owner: identity, display name, email, and avatar
// image (null when the account has none). No account role or quota rides here -- this is a display summary, not the
// caller's own profile.
export interface UserSummary
{
    id : string;
    name : string;
    email : string;
    image : string | null;
}

export interface NodeListResponse
{
    nodes : NodeResponse[];
    total : number;
    limit : number;
    offset : number;

    // The distinct owners of the nodes in the listed folder -- the WHOLE folder, not just the returned page, and
    // unfiltered by the query's own filters, so it doubles as the owner-filter menu's source. Empty for a search
    // envelope, which has no single folder to face.
    owners : UserSummary[];
}

//----------------------------------------------------------------------------------------------------------------------
