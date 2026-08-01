//----------------------------------------------------------------------------------------------------------------------
// Admin API DTOs
//
// The admin-only surface for managing other users. Setting a quota carries a single field: the byte cap, or null for
// unlimited. The successful response is the updated user's UserProfile -- the same row shape the admin listing returns.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { DatabaseKind } from '../database.ts';
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

//----------------------------------------------------------------------------------------------------------------------
// Overview aggregates (part of GET /api/admin/status)
//
// Every figure is a live COUNT or SUM, never a stored counter or a sampled history -- the readout is whatever the
// tables say at request time.
//
// The three byte totals answer three different questions and will not agree: logicalBytes is what the instance
// CHARGES (owned file nodes, trashed ones included -- the quota rule), physicalBytes is every live blob on disk after
// dedup (avatars and the instance logo among them, which no file node charges anyone for), and graveyardBytes is what
// a garbage-collection sweep would hand back once the grace window closes. The gap between the first two is mostly
// dedup, but it is not only dedup -- do not present it as a pure dedup ratio.
//----------------------------------------------------------------------------------------------------------------------

export interface OverviewUsers
{
    total : number;
    admins : number;
    banned : number;
    newThisWeek : number;
}

export interface OverviewNodes
{
    files : number;
    folders : number;
}

export interface OverviewStorage
{
    logicalBytes : number;
    physicalBytes : number;
    graveyardBytes : number;
    graveyardCount : number;
}

export interface OverviewTrash
{
    count : number;
    bytes : number;
}

export interface OverviewInstance
{
    version : string;
    databaseKind : DatabaseKind;
    uptimeSeconds : number;
    emailEnabled : boolean;
    activeProviders : number;
    signUpEnabled : boolean;
}

export interface AdminOverview
{
    users : OverviewUsers;
    nodes : OverviewNodes;
    storage : OverviewStorage;
    trash : OverviewTrash;
    accessRequestsPending : number;
    instance : OverviewInstance;
}

export interface AdminStatusResponse
{
    overview : AdminOverview;
    backends : StorageBackendStatus[];
    gc : GcRunStatus | null;
    trashPurge : TrashPurgeRunStatus | null;
}

//----------------------------------------------------------------------------------------------------------------------
