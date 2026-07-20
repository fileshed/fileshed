//----------------------------------------------------------------------------------------------------------------------
// Me API DTO
//
// Response contract for GET /api/me: the caller's own profile plus quota usage. limit mirrors
// UserProfile.quotaLimit (null = unlimited); used is the live charged-usage aggregate, computed fresh
// per request.
//----------------------------------------------------------------------------------------------------------------------

// Models
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
    createdAt : string;
}

//----------------------------------------------------------------------------------------------------------------------
