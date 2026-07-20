//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Request/Response Contracts
//
// The offeree-facing surface of the recipients-may-copy flow. Offers carry a snapshot of the deleted file (the node
// is gone by the time the offeree sees one), so the response is self-contained; accepting places a fresh owned copy,
// with the same placement shape a save-a-copy takes. Dates serialize as ISO strings.
//----------------------------------------------------------------------------------------------------------------------

export interface DeletionOfferResponse
{
    id : string;
    sha256 : string;
    name : string;
    mimeType : string;
    size : number;
    createdBy : string;
    createdAt : string;
    expiresAt : string;
}

export interface DeletionOfferListResponse
{
    offers : DeletionOfferResponse[];
}

export interface AcceptDeletionOfferRequest
{
    parentID : string | null;
    name ?: string;
}

//----------------------------------------------------------------------------------------------------------------------
