//----------------------------------------------------------------------------------------------------------------------
// Instance Default Quota — enforced through the real claim/upload flow
//
// The contract the whole feature rests on: an account whose quota_limit is NULL inherits the instance default rather
// than being unlimited, and the supplier is read per enforcement, so an admin moving DEFAULT_QUOTA_BYTES binds the
// very next claim with no restart. A per-user value still wins over the default in both directions -- an explicit 0
// pins an account unlimited under a tightened instance, and a per-user cap holds under a roomier one.
//----------------------------------------------------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Support
import { type BootedBlobApp, bootBlobApp, claim, makeUser, putUpload } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const KILOBYTE = 1024;

let booted : BootedBlobApp;

// The live instance default the manager reads on every enforcement; each test moves it and re-claims.
let defaultQuota : number;

beforeEach(async () =>
{
    defaultQuota = 0;
    booted = await bootBlobApp({ defaultQuota: async () => defaultQuota });
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

function sha256Of(data : Buffer) : string
{
    return createHash('sha256')
        .update(data)
        .digest('hex');
}

async function claimBytes(cookie : string, data : Buffer) : Promise<Response>
{
    return claim(booted.app, cookie, sha256Of(data), data.length);
}

//----------------------------------------------------------------------------------------------------------------------

describe('DEFAULT_QUOTA_BYTES enforcement', () =>
{
    it('refuses an inheriting account a claim past the instance default', async () =>
    {
        const user = await makeUser(booted, 'inherits@example.com');
        defaultQuota = KILOBYTE;

        const res = await claimBytes(user.cookie, randomBytes(4 * KILOBYTE));
        const body = await res.json() as { error : string };

        expect(res.status).toBe(403);
        expect(body.error.toLowerCase()).toContain('quota');
    });

    // The point of a supplier over a boot-frozen number: the same signed-in session, the same app, a different verdict
    // the moment the setting moves.
    it('admits the identical claim once the instance default returns to unlimited', async () =>
    {
        const user = await makeUser(booted, 'inherits@example.com');
        const data = randomBytes(4 * KILOBYTE);

        defaultQuota = KILOBYTE;
        expect((await claimBytes(user.cookie, data)).status).toBe(403);

        defaultQuota = 0;
        expect((await claimBytes(user.cookie, data)).status).toBe(200);
    });

    // The default caps what an account holds in total, not what it uploads at once: a second file that fits on its own
    // but not beside the first is refused.
    it('charges an inheriting account\'s cumulative usage against the instance default', async () =>
    {
        const user = await makeUser(booted, 'inherits@example.com');
        defaultQuota = 6 * KILOBYTE;

        const first = randomBytes(4 * KILOBYTE);
        const claimed = await claimBytes(user.cookie, first) as Response;
        const ticket = (await claimed.json() as { ticket : string }).ticket;
        expect((await putUpload(booted.app, user.cookie, ticket, first)).status).toBe(200);

        const second = await claimBytes(user.cookie, randomBytes(4 * KILOBYTE));

        expect(second.status).toBe(403);
    });

    it('holds an explicitly unlimited account above a tightened instance default', async () =>
    {
        const pinned = await makeUser(booted, 'pinned@example.com', 0);
        defaultQuota = KILOBYTE;

        expect((await claimBytes(pinned.cookie, randomBytes(4 * KILOBYTE))).status).toBe(200);
    });

    it('still enforces a per-user cap tighter than the instance default', async () =>
    {
        const capped = await makeUser(booted, 'capped@example.com', 2 * KILOBYTE);
        defaultQuota = 1024 * KILOBYTE;

        expect((await claimBytes(capped.cookie, randomBytes(4 * KILOBYTE))).status).toBe(403);
    });
});

//----------------------------------------------------------------------------------------------------------------------
