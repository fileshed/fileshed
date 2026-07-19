//----------------------------------------------------------------------------------------------------------------------
// User Profile Domain Model
//
// The app-side surface of a user (requirements.md secs 3.1/5). BetterAuth owns identity and its own columns; core
// carries only the profile the app reasons about. role here is the account role (admin/user), distinct from the
// permission Role. quotaLimit is a byte cap, or null for unlimited.
//----------------------------------------------------------------------------------------------------------------------

export const userRoles = [ 'admin', 'user' ] as const;
export type UserRole = typeof userRoles[number];

export interface UserProfile
{
    id : string;
    email : string;
    name ?: string;
    role : UserRole;
    quotaLimit : number | null;
    createdAt : Date;
}

//----------------------------------------------------------------------------------------------------------------------
