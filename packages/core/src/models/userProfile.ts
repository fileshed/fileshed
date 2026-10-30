//----------------------------------------------------------------------------------------------------------------------
// User Profile Domain Model
//
// BetterAuth owns identity and its own columns; core carries only the profile the app reasons about. role is the
// account role (admin/user), distinct from the permission Role. quotaLimit is the account's own setting rather than the
// effective cap: null inherits the instance default and 0 is explicitly unlimited.
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

    // Ban state, admin-set. A banned account cannot sign in and its access tokens are deleted the moment the ban
    // lands; banExpires null means the ban holds until an admin lifts it.
    banned : boolean;
    banReason : string | null;
    banExpires : Date | null;

    createdAt : Date;
}

//----------------------------------------------------------------------------------------------------------------------
