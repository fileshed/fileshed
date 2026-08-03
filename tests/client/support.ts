//----------------------------------------------------------------------------------------------------------------------
// Client Spec Support
//----------------------------------------------------------------------------------------------------------------------

import type { MeResponse } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// The signed-in caller's id. Node fixtures that mean "owned by the caller" set ownerID to this, so the owner-gated
// surfaces read own-tree unless a spec deliberately hands a node a different owner.
export const ME_ID = 'u1';

// The signed-in caller's profile: an ordinary member with an empty, uncapped quota and no preferences set.
export function meFixture(overrides : Partial<MeResponse> = {}) : MeResponse
{
    return {
        id: ME_ID,
        email: 'member@example.com',
        name: 'Ada Lovelace',
        role: 'user',
        quota: { used: 0, effective: null, limit: null },
        limits: { trashRetentionDays: 30 },
        preferences: {},
        image: null,
        createdAt: '2026-07-20T00:00:00.000Z',
        ...overrides,
    };
}

//----------------------------------------------------------------------------------------------------------------------
