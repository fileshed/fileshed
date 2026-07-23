//----------------------------------------------------------------------------------------------------------------------
// Me API DTO
//
// Response contract for GET /api/me: the caller's own profile plus quota usage and preferences. limit mirrors
// UserProfile.quotaLimit (null = unlimited); used is the live charged-usage aggregate, computed fresh per request.
// preferences is the caller's known-view preferences blob.
//----------------------------------------------------------------------------------------------------------------------

// Models
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
        limit : number | null;
    };

    // Effective deployment limits the client must not guess at: the configured values, not the shipped defaults,
    // so copy like the trash-retention line never lies about an overridden deployment.
    limits : {
        trashRetentionDays : number;
    };
    preferences : UserPreferences;

    // The caller's avatar as a URL to fetch its bytes, or null when the account has none. Derived from the stored
    // avatar hash at serialization time -- never a persisted URL.
    image ?: string | null;
    createdAt : string;
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
    [key : string] : unknown;
}

//----------------------------------------------------------------------------------------------------------------------
