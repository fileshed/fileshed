//----------------------------------------------------------------------------------------------------------------------
// Admin Access Engine
//
// Plain RBAC on the account role, kept out of the regulation engine: whether an account is an admin is a fact about
// the caller, not about the records it touches.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { ForbiddenError } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// The role column is the admin plugin's, nullable text, so anything but the exact value is a non-admin.
export function assertAdmin(caller : { role ?: string | null }) : void
{
    if(caller.role !== 'admin') { throw new ForbiddenError('Admin access is required.'); }
}

//----------------------------------------------------------------------------------------------------------------------
