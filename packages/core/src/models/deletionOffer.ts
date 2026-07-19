//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Domain Model
//
// A time-boxed "save a copy" offer minted when an owner hard-deletes a shared file with recipients-may-copy enabled
// (requirements.md secs 3.1/4.4). name/mimeType/size snapshot the deleted node, since the node itself is gone by the
// time the offeree sees this. expiresAt is the blob's GC grace deadline -- accept before then and the claim path can
// still resurrect the blob.
//----------------------------------------------------------------------------------------------------------------------

export interface DeletionOffer
{
    id : string;
    sha256 : string;
    offereeID : string;
    name : string;
    mimeType : string;
    size : number;
    createdBy : string;
    createdAt : Date;
    expiresAt : Date;
}

//----------------------------------------------------------------------------------------------------------------------
