//----------------------------------------------------------------------------------------------------------------------
// Storage Backend Domain Model
//
// config is opaque here: its shape is backend-specific, and the backend that consumes it validates it.
//----------------------------------------------------------------------------------------------------------------------

export const storageBackendKinds = [ 'fs', 'db', 's3', 'azure' ] as const;
export type StorageBackendKind = typeof storageBackendKinds[number];

export interface StorageBackend
{
    id : string;
    kind : StorageBackendKind;
    config : Record<string, unknown>;
    isDefault : boolean;
}

//----------------------------------------------------------------------------------------------------------------------
