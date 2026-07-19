//----------------------------------------------------------------------------------------------------------------------
// Storage Backend Domain Model
//
// A configured blob-storage backend instance (requirements.md secs 3.1/4.1). config is opaque here: its shape is
// backend-specific and validated by the backend that consumes it, not at this boundary.
//----------------------------------------------------------------------------------------------------------------------

export type StorageBackendKind = 'fs' | 'db' | 's3' | 'azure';

export interface StorageBackend
{
    id : string;
    kind : StorageBackendKind;
    config : Record<string, unknown>;
    isDefault : boolean;
}

//----------------------------------------------------------------------------------------------------------------------
