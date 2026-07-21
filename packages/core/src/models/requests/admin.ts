//----------------------------------------------------------------------------------------------------------------------
// Admin API DTOs
//
// The admin-only surface for managing other users. Setting a quota carries a single field: the byte cap, or null for
// unlimited. The successful response is the updated user's UserProfile -- the same row shape the admin listing returns.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { StorageBackendKind } from '../storageBackend.ts';
import type { UserRole } from '../userProfile.ts';

//----------------------------------------------------------------------------------------------------------------------
// Set quota (PATCH /api/admin/users/:id)
//----------------------------------------------------------------------------------------------------------------------

export interface SetQuotaRequest
{
    quotaLimit : number | null;
}

//----------------------------------------------------------------------------------------------------------------------
// User rows (GET /api/admin/users, PATCH /api/admin/users/:id)
//
// The wire form of a UserProfile: the same fields with createdAt as an ISO string. Both the listing page and the
// set-quota response carry this shape, so neither side of the wire composes it ad hoc.
//----------------------------------------------------------------------------------------------------------------------

export interface AdminUserResponse
{
    id : string;
    email : string;
    name ?: string;
    role : UserRole;
    quotaLimit : number | null;
    createdAt : string;
}

export interface AdminUserPageResponse
{
    users : AdminUserResponse[];
    total : number;
    limit : number;
    offset : number;
}

//----------------------------------------------------------------------------------------------------------------------
// Status (GET /api/admin/status)
//
// A single admin diagnostics readout: the configured storage backends and the outcome of the last background sweeps.
// A backend row never carries its config blob -- it can hold backend credentials (s3/azure keys) that no status view
// should expose. gc and trashPurge are null until their sweep has run at least once this process.
//----------------------------------------------------------------------------------------------------------------------

export interface StorageBackendStatus
{
    id : string;
    kind : StorageBackendKind;
    isDefault : boolean;
}

export interface GcRunSummary
{
    candidates : number;
    deleted : number;
    kept : number;
    bytesFailed : number;
}

export interface TrashPurgeRunSummary
{
    candidates : number;
    purged : number;
    failed : number;
}

export interface GcRunStatus
{
    ranAt : string;
    summary : GcRunSummary;
}

export interface TrashPurgeRunStatus
{
    ranAt : string;
    summary : TrashPurgeRunSummary;
}

export interface AdminStatusResponse
{
    backends : StorageBackendStatus[];
    gc : GcRunStatus | null;
    trashPurge : TrashPurgeRunStatus | null;
}

//----------------------------------------------------------------------------------------------------------------------
