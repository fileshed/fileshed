//----------------------------------------------------------------------------------------------------------------------
// UserManager — the account profile
//
// Driven against a real database: usage is summed from seeded file nodes, and every supplier is the one the
// composition would read live, so each expectation is the value a client renders.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { UNLIMITED_QUOTA } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { NodeRA } from '@server/resource-access/nodes/index.ts';

// Managers
import { UserManager, type UserManagerDeps } from '@server/managers/user.ts';

// Support
import {
    createTestDatabase,
    fileNode,
    folderNode,
    linkNode,
    seedBackend,
    seedBlob,
    seedUser,
    setUserQuota,
} from '../resource-access/nodes/support.ts';
import { testActor } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let handle : DatabaseHandle;
let ra : NodeRA;

function userManager(overrides : Partial<Omit<UserManagerDeps, 'handle'>> = {}) : UserManager
{
    return new UserManager({
        handle,
        defaultQuota: async () => UNLIMITED_QUOTA,
        trashRetentionDays: async () => 30,
        accountDeletionDays: async () => 30,
        deletionSchedule: async () => null,
        ...overrides,
    });
}

beforeEach(async () =>
{
    handle = await createTestDatabase();
    ra = new NodeRA(handle);

    await seedUser(handle.db, 'alice');
    await seedBackend(handle.db, 'be1');
    await seedBlob(handle.db, 'sha-a', 'be1');
});

afterEach(async () =>
{
    await handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('UserManager.me', () =>
{
    it('charges owned file nodes including trashed, excluding folders and links', async () =>
    {
        await ra.insert(fileNode({ id: 'f1', ownerID: 'alice', blobID: 'sha-a', size: 1000 }));
        await ra.insert(fileNode({ id: 'f2', ownerID: 'alice', blobID: 'sha-a', size: 500, trashedAt: new Date() }));
        await ra.insert(folderNode({ id: 'dir', ownerID: 'alice' }));
        await ra.insert(linkNode({ id: 'lnk', ownerID: 'alice', targetNodeID: 'dir' }));

        await setUserQuota(handle.db, 'alice', 1_000_000);

        const me = await userManager().me(testActor({ id: 'alice', email: 'alice@example.com' }));

        expect(me.quota.used).toBe(1500);
        expect(me.quota.limit).toBe(1_000_000);
    });

    // The profile is what the client renders the quota meter from, so it must agree with what the next upload will
    // actually be judged against -- a cap read from a session snapshot would keep showing the old number after an
    // admin moved it.
    it('reports a cap changed since sign-in, not the one the session was issued with', async () =>
    {
        const actor = testActor({ id: 'alice' });

        await setUserQuota(handle.db, 'alice', 4096);

        expect((await userManager().me(actor)).quota).toEqual({ used: 0, effective: 4096, limit: 4096 });
    });

    // 0 is the account's own "no cap", which is what pins a user above a tightened instance default; null would
    // inherit that default instead. The raw value travels verbatim so the client can tell the two states apart.
    it('pins an explicitly-unlimited account above a tightened instance default', async () =>
    {
        await setUserQuota(handle.db, 'alice', 0);

        const me = await userManager({ defaultQuota: async () => 4096 }).me(testActor({ id: 'alice' }));

        expect(me.quota).toEqual({ used: 0, effective: null, limit: 0 });
    });

    // The client renders retention copy from these values, so they must be the deployment's configured numbers --
    // never a shipped default a deployment has overridden.
    it('reports the configured trash retention and deletion window', async () =>
    {
        const manager = userManager({ trashRetentionDays: async () => 2, accountDeletionDays: async () => 9 });

        const me = await manager.me(testActor({ id: 'alice' }));

        expect(me.limits).toEqual({ trashRetentionDays: 2, accountDeletionDays: 9 });
    });
});

//----------------------------------------------------------------------------------------------------------------------
