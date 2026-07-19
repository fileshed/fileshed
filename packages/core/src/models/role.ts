//----------------------------------------------------------------------------------------------------------------------
// Role Domain Model
//
// Permission roles and the share-grantable subset. ShareRole is derived by excluding 'owner' because a share confers
// access, never ownership (requirements.md sec 3.4) -- deriving it keeps the two in lockstep and makes an owner-grant
// unrepresentable rather than merely discouraged.
//----------------------------------------------------------------------------------------------------------------------

export type Role = 'viewer' | 'editor' | 'owner';

export type ShareRole = Exclude<Role, 'owner'>;

//----------------------------------------------------------------------------------------------------------------------
