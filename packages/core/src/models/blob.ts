//----------------------------------------------------------------------------------------------------------------------
// Blob Domain Model
//
// A content-addressed storage record identified by its sha256 (the primary key, requirements.md secs 3.1/4.2). The ref
// count is derived from referencing nodes, never stored here. deletedAt is the GC graveyard marker: null while
// referenced, set when the last reference drops, cleared again if a later claim resurrects the blob.
//----------------------------------------------------------------------------------------------------------------------

export interface Blob
{
    sha256 : string;
    size : number;
    backendID : string;
    storageKey : string;
    createdAt : Date;
    deletedAt : Date | null;
}

//----------------------------------------------------------------------------------------------------------------------
