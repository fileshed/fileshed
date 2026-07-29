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
// User management actions (POST /api/admin/users/:id/...)
//
// Ban, role, and password land as small dedicated actions rather than one grab-bag PATCH, because each carries its
// own semantics: a ban optionally expires (days; absent = until lifted), a role change is guarded against
// self-demotion, and a password set is the no-email password-reset fallback.
//----------------------------------------------------------------------------------------------------------------------

export interface BanUserRequest
{
    reason ?: string;
    expiresInDays ?: number;
}

export interface SetRoleRequest
{
    role : UserRole;
}

export interface SetPasswordRequest
{
    password : string;
}

//----------------------------------------------------------------------------------------------------------------------
// Test email (POST /api/admin/email/test)
//----------------------------------------------------------------------------------------------------------------------

export interface TestEmailResponse
{
    to : string;
}

//----------------------------------------------------------------------------------------------------------------------
// Listing query (GET /api/admin/users)
//----------------------------------------------------------------------------------------------------------------------

export const adminUserSortKeys = [ 'name', 'email', 'createdAt' ] as const;
export type AdminUserSortKey = typeof adminUserSortKeys[number];

export const adminUserSearchFields = [ 'email', 'name' ] as const;
export type AdminUserSearchField = typeof adminUserSearchFields[number];

//----------------------------------------------------------------------------------------------------------------------
// User rows (GET /api/admin/users and every action's response)
//
// The wire form of a UserProfile plus the bytes the account's owned files charge: the same row shape everywhere, so
// neither side of the wire composes it ad hoc. Dates are ISO strings.
//----------------------------------------------------------------------------------------------------------------------

export interface AdminUserResponse
{
    id : string;
    email : string;
    name ?: string;
    role : UserRole;
    quotaLimit : number | null;
    banned : boolean;
    banReason : string | null;
    banExpires : string | null;
    usedBytes : number;
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
