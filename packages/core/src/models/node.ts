//----------------------------------------------------------------------------------------------------------------------
// Node Domain Model
//
// Canonical domain type for a node -- a file, folder, or link in a user's tree (their "My Drive"). Modeled as a
// discriminated union on `type` rather than one interface with a pile of nullables, so that a variant's exclusive
// fields (blobID, size, mimeType, targetNodeID, trashedAt) simply don't exist on the wrong shape.
//----------------------------------------------------------------------------------------------------------------------

export const nodeTypes = [ 'file', 'folder', 'link' ] as const;
export type NodeType = typeof nodeTypes[number];

interface NodeBase
{
    id : string;
    name : string;
    ownerID : string;
    parentID : string | null;
    createdAt : Date;
    updatedAt : Date;
}

//----------------------------------------------------------------------------------------------------------------------
// Type Variants
//----------------------------------------------------------------------------------------------------------------------

export interface FileNode extends NodeBase
{
    type : 'file';
    blobID : string;
    size : number;
    mimeType : string;
    trashedAt : Date | null;
}

export interface FolderNode extends NodeBase
{
    type : 'folder';
    trashedAt : Date | null;
}

// A link is the recipient-side placement of a shared item: an ordinary node, owned by the recipient, pointing at
// someone else's node. Links may not target links (enforced by managers/engines, not this type). Links carry no
// mimeType (it derives from the target) and no trashedAt -- links are deleted directly, never trashed; dead links
// persist as stubs.
export interface LinkNode extends NodeBase
{
    type : 'link';
    targetNodeID : string;
}

export type Node = FileNode | FolderNode | LinkNode;

//----------------------------------------------------------------------------------------------------------------------
// Ownership
//----------------------------------------------------------------------------------------------------------------------

// Whether `userID` owns this node OUTRIGHT. This is the administration gate -- who may share it, revoke a grant on it,
// publish a link to it, trash it, or delete it permanently.
//
// It is deliberately NOT the same question as the permission resolver's 'owner' role. A user also resolves to 'owner'
// by owning an ANCESTOR of a node, because contributions travel with the folder that holds them: a folder owner
// resolves 'owner' on a file another user contributed into their folder and may read it. They must not thereby be able
// to re-share or publish content they do not own. Access asks the resolver; authority over the node asks this.
export function isDirectOwner(node : Node, userID : string) : boolean
{
    return node.ownerID === userID;
}

//----------------------------------------------------------------------------------------------------------------------
