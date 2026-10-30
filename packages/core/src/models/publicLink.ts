//----------------------------------------------------------------------------------------------------------------------
// Public Link Domain Model
//
// The token is the whole capability: it grants the bytes and says nothing about how a recipient's browser presents
// them. Links are revoked rather than deleted, so a revoked token still resolves, to a dead link.
//----------------------------------------------------------------------------------------------------------------------

export interface PublicLink
{
    id : string;
    nodeID : string;
    token : string;
    created : Date;
    revokedAt : Date | null;
}

//----------------------------------------------------------------------------------------------------------------------
