//----------------------------------------------------------------------------------------------------------------------
// Node Domain Model
//----------------------------------------------------------------------------------------------------------------------

export const nodeTypes = [ 'file', 'folder', 'link' ] as const;
export type NodeType = typeof nodeTypes[number];

interface NodeBase
{
    id : string;
    name : string;
    ownerID : string;
    parentID : string | null;
    created : Date;
    updated : Date;
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
    trashed : Date | null;
}

export interface FolderNode extends NodeBase
{
    type : 'folder';
    trashed : Date | null;
}

// A link is the recipient-side placement of a shared item: an ordinary node, owned by the recipient, pointing at
// someone else's node. Links may not target links (enforced by managers/engines, not this type). Links carry no
// mimeType (it derives from the target) and no trashed timestamp -- links are deleted directly, never trashed; dead
// links persist as stubs.
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

// Whether a node is in the trash and `userID` is not the one whose trash it is. Such a node reads as absent: a
// recipient gets a 404, not a reply that confirms the node still exists, while its direct owner keeps seeing it in
// their trash. A link is never trashed on its own account.
export function isHiddenTrash(node : Node, userID : string) : boolean
{
    return node.type !== 'link' && node.trashed !== null && !isDirectOwner(node, userID);
}

//----------------------------------------------------------------------------------------------------------------------
