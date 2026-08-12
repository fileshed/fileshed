//----------------------------------------------------------------------------------------------------------------------
// Client Spec Support
//----------------------------------------------------------------------------------------------------------------------

import type { MeResponse } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// A listing mounts only the rows its scroller has room for, which it works out from real layout. jsdom has none, so a
// virtualized surface would render nothing at all under test. This stand-in keeps the scroller's contract -- items in,
// one scoped slot per item, each wrapped in the item element a click looks for -- and renders every row, leaving the
// spec free to assert on what the surface does rather than on what a scroller chose to mount.
export const SCROLL_AREA_STUB = {
    props: [ 'items' ],
    template: '<div class="scroll-area">'
        + '<div v-for="(item, index) in items" :key="index" data-slot="item">'
        + '<slot :item="item" :index="index" />'
        + '</div>'
        + '</div>',
};

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
