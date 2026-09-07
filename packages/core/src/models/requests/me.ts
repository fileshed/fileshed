//----------------------------------------------------------------------------------------------------------------------
// Me API DTO
//
// Response contract for GET /api/me: the caller's own profile plus quota usage and preferences. used is the live
// charged-usage aggregate, computed fresh per request; preferences is the caller's known-view preferences blob.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ColorMode } from '../instanceTheme.ts';
import type { TimeFormat, UserPreferences, ViewMode } from '../userPreferences.ts';
import type { UserRole } from '../userProfile.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface MeResponse
{
    id : string;
    email : string;
    name ?: string;
    role : UserRole;
    quota : {
        used : number;

        // What is actually enforced against this account, instance default already folded in; null is unlimited.
        // Anything showing the caller their cap wants this one.
        effective : number | null;

        // The raw per-user setting behind it: a byte cap of their own, 0 for explicitly unlimited, or null to
        // inherit whatever the instance default currently says.
        limit : number | null;
    };

    // Effective deployment limits the client must not guess at: the configured values, not the shipped defaults,
    // so copy like the trash-retention line never lies about an overridden deployment.
    limits : {
        trashRetentionDays : number;

        // How long a requested account deletion waits before it is carried out. Named in the copy that asks the
        // caller to confirm, so the sentence describes this deployment rather than the shipped default.
        accountDeletionDays : number;
    };
    preferences : UserPreferences;

    // The caller's avatar as a URL to fetch its bytes, or null when the account has none. Derived from the stored
    // avatar hash at serialization time -- never a persisted URL.
    image ?: string | null;
    createdAt : string;

    // Set only while the caller has asked for their account to be deleted and the window has yet to run out. The due
    // date is derived from the request against the instance's current window, so an admin who lengthens it moves this
    // -- it is what the account will be deleted after, not a promise made at the moment of asking.
    deletion : AccountDeletionSchedule | null;
}

// What the caller sees of their own pending deletion.
export interface AccountDeletionSchedule
{
    requestedAt : string;
    scheduledFor : string;
}

//----------------------------------------------------------------------------------------------------------------------

// A partial patch of the preferences blob for PATCH /api/me/preferences. A key set to a value updates it; a key set to
// null deletes it (rootLabel null resets the files-root name to its default). Unknown keys are carried through to
// storage untouched -- the deliberate forward-compat exception to the strict-object DTO convention, so a preference a
// newer client wrote is never stripped by an older one. The known keys are still validated.
export interface UpdatePreferencesRequest
{
    rootLabel ?: string | null;
    timeFormat ?: TimeFormat | null;
    editorTheme ?: string | null;
    editorGutter ?: boolean | null;
    viewMode ?: ViewMode | null;
    colorMode ?: ColorMode | null;
    allowRemoteMedia ?: boolean | null;
    [key : string] : unknown;
}

//----------------------------------------------------------------------------------------------------------------------
