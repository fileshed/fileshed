//----------------------------------------------------------------------------------------------------------------------
// Version API DTOs
//----------------------------------------------------------------------------------------------------------------------

export interface VersionResponse
{
    version : string;

    // Null when the build recorded neither: an image built without the git facts, or an install from a tarball with
    // no repository behind it.
    commit : string | null;
    branch : string | null;
}

//----------------------------------------------------------------------------------------------------------------------
