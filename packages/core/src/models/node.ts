//----------------------------------------------------------------------------------------------------------------------
// Node Domain Model
//
// Canonical domain type for a node -- a file, folder, or link in a user's tree (their "My Drive"). Modeled as a
// discriminated union on `type` rather than one interface with a pile of nullables, so that a variant's exclusive
// fields (blobID, size, mimeType, targetNodeID, trashedAt) simply don't exist on the wrong shape. See
// requirements.md secs 3.1/3.2/3.2b for the placement and ownership rules a node participates in.
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
// persist as stubs (requirements secs 3.2b/4.4).
export interface LinkNode extends NodeBase
{
    type : 'link';
    targetNodeID : string;
}

export type Node = FileNode | FolderNode | LinkNode;

//----------------------------------------------------------------------------------------------------------------------
