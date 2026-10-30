//----------------------------------------------------------------------------------------------------------------------
// Blob Domain Model
//
// The ref count is derived from referencing nodes and never stored. deleted is the GC graveyard marker: null while
// referenced, set when the last reference drops, cleared again if a later claim resurrects the blob.
//----------------------------------------------------------------------------------------------------------------------

export interface Blob
{
    sha256 : string;
    size : number;
    backendID : string;
    storageKey : string;
    created : Date;
    deleted : Date | null;
}

//----------------------------------------------------------------------------------------------------------------------
