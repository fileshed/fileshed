//----------------------------------------------------------------------------------------------------------------------
// Node Placement Regulation
//
// Move legality: which moves are legal given the moving set and the destination path. A folder cannot be moved into
// itself or into any of its own descendants. The picker only reaches a descendant by first descending through the
// moving folder, so both rules reduce to one check -- the moving node's id must not appear anywhere on the path from
// root to the candidate destination. The server re-validates regardless; this just spares the user a round trip and a
// toast for a move the picker already knows is impossible.
//----------------------------------------------------------------------------------------------------------------------

// The folder ids from root to a candidate destination, inclusive of the destination. My Files's root is the empty path.
export function canMoveInto(movingNodeID : string, destinationPathIDs : readonly string[]) : boolean
{
    return !destinationPathIDs.includes(movingNodeID);
}

// Whether the picker may descend into a listed folder. Descending into the moving folder itself would walk into its own
// subtree, so that one door stays shut.
export function canEnterFolder(movingNodeID : string, folderID : string) : boolean
{
    return folderID !== movingNodeID;
}

//----------------------------------------------------------------------------------------------------------------------
// Multi-select: a bulk move is legal only where every moving node's move is legal. A folder in the selection vetoes its
// own subtree; a file never appears on a path so it never vetoes. Both reduce to applying the single-node rules across
// the whole selection.
//----------------------------------------------------------------------------------------------------------------------

export function canMoveAllInto(movingNodeIDs : readonly string[], destinationPathIDs : readonly string[]) : boolean
{
    return movingNodeIDs.every((id) => canMoveInto(id, destinationPathIDs));
}

export function canEnterFolderForMove(movingNodeIDs : readonly string[], folderID : string) : boolean
{
    return movingNodeIDs.every((id) => canEnterFolder(id, folderID));
}

//----------------------------------------------------------------------------------------------------------------------
