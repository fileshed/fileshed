//----------------------------------------------------------------------------------------------------------------------
// Client Spec Support
//----------------------------------------------------------------------------------------------------------------------

import type {
    FileNodeResponse,
    FolderNodeResponse,
    InstanceResponse,
    LinkNodeResponse,
    MeResponse,
} from '@fileshed/core';

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
        limits: { trashRetentionDays: 30, accountDeletionDays: 30 },
        preferences: {},
        image: null,
        created: '2026-07-20T00:00:00.000Z',
        deletion: null,
        ...overrides,
    };
}

//----------------------------------------------------------------------------------------------------------------------

// Node fixtures: owned by the caller, at their root, untrashed and unshared. The name follows the id unless an
// override sets it, so a spec that only cares which node it is can name it once.
const NODE_TIME = '2026-07-01T00:00:00.000Z';

export function fileNode(overrides : Partial<FileNodeResponse> = {}) : FileNodeResponse
{
    const id = overrides.id ?? 'f1';

    return {
        id,
        name: id,
        ownerID: ME_ID,
        parentID: null,
        created: NODE_TIME,
        updated: NODE_TIME,
        role: 'owner',
        sharing: null,
        type: 'file',
        blobID: 'b1',
        size: 100,
        mimeType: 'text/plain',
        trashedAt: null,
        ...overrides,
    };
}

export function folderNode(overrides : Partial<FolderNodeResponse> = {}) : FolderNodeResponse
{
    const id = overrides.id ?? 'd1';

    return {
        id,
        name: id,
        ownerID: ME_ID,
        parentID: null,
        created: NODE_TIME,
        updated: NODE_TIME,
        role: 'owner',
        sharing: null,
        type: 'folder',
        trashedAt: null,
        ...overrides,
    };
}

export function linkNode(overrides : Partial<LinkNodeResponse> = {}) : LinkNodeResponse
{
    const id = overrides.id ?? 'l1';

    return {
        id,
        name: id,
        ownerID: ME_ID,
        parentID: null,
        created: NODE_TIME,
        updated: NODE_TIME,
        role: 'owner',
        sharing: null,
        type: 'link',
        targetNodeID: 't1',
        target: null,
        ...overrides,
    };
}

// The instance handshake of an initialized deployment that takes sign-ups, sends no mail, and registered no providers.
export function instanceFixture(overrides : Partial<InstanceResponse> = {}) : InstanceResponse
{
    return {
        limits: { skippedUploadNames: [], uploadMaxBytes: 5_368_709_120, avatarMaxBytes: 2_097_152 },
        needsSetup: false,
        signUpEnabled: true,
        emailEnabled: false,
        providers: [],
        branding: { instanceName: 'FileShed', mode: 'system', forcedMode: false, logo: null },
        ...overrides,
    };
}

//----------------------------------------------------------------------------------------------------------------------
