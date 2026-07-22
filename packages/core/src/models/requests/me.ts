//----------------------------------------------------------------------------------------------------------------------
// Me API DTO
//
// Response contract for GET /api/me: the caller's own profile plus quota usage and preferences. limit mirrors
// UserProfile.quotaLimit (null = unlimited); used is the live charged-usage aggregate, computed fresh per request.
// preferences is the caller's known-view preferences blob.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { TimeFormat, UserPreferences } from '../userPreferences.ts';
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
    preferences : UserPreferences;
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
    [key : string] : unknown;
}

//----------------------------------------------------------------------------------------------------------------------
