//----------------------------------------------------------------------------------------------------------------------
// Public Link Domain Model
//
// Tokened anonymous access to a node. The token is the whole capability: it grants the bytes, and says nothing about
// how a recipient's browser presents them. revokedAt is the kill switch: null while the link is live, set once revoked.
// Links are revoked, not deleted, so a revoked token still resolves -- to a dead link.
//----------------------------------------------------------------------------------------------------------------------

export interface PublicLink
{
    id : string;
    nodeID : string;
    token : string;
    createdAt : Date;
    revokedAt : Date | null;
}

//----------------------------------------------------------------------------------------------------------------------
