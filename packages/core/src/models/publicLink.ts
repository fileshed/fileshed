//----------------------------------------------------------------------------------------------------------------------
// Public Link Domain Model
//
// Tokened anonymous access to a node (requirements.md secs 3.1/6). revokedAt is the kill switch: null while the link is
// live, set once revoked. Links are revoked, not deleted, so a revoked token still resolves -- to a dead link.
//----------------------------------------------------------------------------------------------------------------------

export type PublicLinkMode = 'view' | 'download';

export type PublicLinkDisposition = 'inline' | 'attachment';

export interface PublicLink
{
    id : string;
    nodeID : string;
    token : string;
    mode : PublicLinkMode;
    disposition : PublicLinkDisposition;
    createdAt : Date;
    revokedAt : Date | null;
}

//----------------------------------------------------------------------------------------------------------------------
