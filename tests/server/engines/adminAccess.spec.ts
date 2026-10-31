//----------------------------------------------------------------------------------------------------------------------
// Admin Access Engine — who may use the admin surface
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import { ForbiddenError } from '@fileshed/core';

// Engines
import { assertAdmin } from '@server/engines/adminAccess.ts';

//----------------------------------------------------------------------------------------------------------------------

describe('assertAdmin', () =>
{
    it('lets an admin through', () =>
    {
        expect(() => assertAdmin({ role: 'admin' })).not.toThrow();
    });

    it('refuses a regular user, and an account the role column has nothing for', () =>
    {
        expect(() => assertAdmin({ role: 'user' })).toThrow(ForbiddenError);
        expect(() => assertAdmin({ role: null })).toThrow(ForbiddenError);
        expect(() => assertAdmin({})).toThrow(ForbiddenError);
    });
});

//----------------------------------------------------------------------------------------------------------------------
