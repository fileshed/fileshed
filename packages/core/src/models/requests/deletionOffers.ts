//----------------------------------------------------------------------------------------------------------------------
// Deletion Offer Request/Response Contracts
//----------------------------------------------------------------------------------------------------------------------

export interface DeletionOfferResponse
{
    id : string;
    sha256 : string;
    name : string;
    mimeType : string;
    size : number;
    createdBy : string;
    created : string;
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
