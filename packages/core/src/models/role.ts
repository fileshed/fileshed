//----------------------------------------------------------------------------------------------------------------------
// Role Domain Model
//
// Permission roles and the share-grantable subset. A share confers access, never ownership (requirements.md sec 3.4),
// so roles is built from shareRoles by construction -- an owner-grant is unrepresentable and the two vocabularies
// cannot drift. The arrays are the single source: the types derive from them, the Zod codecs consume them, and the
// DB CHECK constraints are generated from them.
//----------------------------------------------------------------------------------------------------------------------

export const shareRoles = [ 'viewer', 'editor' ] as const;
export type ShareRole = typeof shareRoles[number];

export const roles = [ ...shareRoles, 'owner' ] as const;
export type Role = typeof roles[number];

//----------------------------------------------------------------------------------------------------------------------
