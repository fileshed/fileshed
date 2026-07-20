//----------------------------------------------------------------------------------------------------------------------
// Role Domain Model
//
// Permission roles and the share-grantable subset. A share confers access, never ownership, so roles is built from
// shareRoles by construction -- an owner-grant is unrepresentable and the two vocabularies cannot drift. The arrays are
// the single source: the types derive from them, the Zod codecs consume them, and the DB CHECK constraints are
// generated from them.
//----------------------------------------------------------------------------------------------------------------------

export const shareRoles = [ 'viewer', 'editor' ] as const;
export type ShareRole = typeof shareRoles[number];

export const roles = [ ...shareRoles, 'owner' ] as const;
export type Role = typeof roles[number];

//----------------------------------------------------------------------------------------------------------------------
// Ordering
//
// The one place the role hierarchy is ranked (effective role = max of every applicable grant and ownership). Both the
// permission resolver and any at-least-editor check derive strength from here, so the ordering owner > editor > viewer
// cannot drift between them.
//----------------------------------------------------------------------------------------------------------------------

export const roleRank : Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

// The stronger of two roles by rank. A null role is "no access" and loses to any actual role; two nulls stay null.
export function maxRole(left : Role | null, right : Role | null) : Role | null
{
    if(left === null) { return right; }
    if(right === null) { return left; }

    return roleRank[left] >= roleRank[right] ? left : right;
}

// Whether a role meets or exceeds a floor (e.g. editor+ authorizes the cross-owner create). null never does.
export function isRoleAtLeast(role : Role | null, floor : Role) : boolean
{
    return role !== null && roleRank[role] >= roleRank[floor];
}

//----------------------------------------------------------------------------------------------------------------------
