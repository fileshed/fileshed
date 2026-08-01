//----------------------------------------------------------------------------------------------------------------------
// E2E — Admin-configurable limits
//
// The settings that bind uploads, across a real socket and a real process: DEFAULT_QUOTA_BYTES caps an account that
// has no limit of its own and releases it again when returned to unlimited, UPLOAD_MAX_BYTES refuses a file larger
// than the cap, and each takes effect on the very next claim -- the server is never restarted in this file. A value
// outside a key's bounds dies at the boundary with a 400 naming the key, leaving the previous cap standing.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Models
import type { ClaimResponse, InstanceLimits } from '@fileshed/core';

// Support
import { ApiClient, type ServerHandle, sha256Of, smallFixture, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const SETUP_TOKEN = 'e2e-setup-token-1234';
const ADMIN_EMAIL = 'admin@fileshed.test';
const ADMIN_PASSWORD = 'admin-password-e2e';
const PASSWORD = 'correct-horse-battery';

const data = smallFixture('fileshed-e2e-limits');
const sha = sha256Of(data);

let server : ServerHandle;
let admin : ApiClient;
let member : ApiClient;

beforeAll(async () =>
{
    server = await spawnServer({ env: { FILESHED_SETUP_TOKEN: SETUP_TOKEN } });

    const setup = await new ApiClient(server.baseURL).post('/api/setup', {
        token: SETUP_TOKEN,
        name: 'Administrator',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
    });
    if(setup.status !== 200) { throw new Error('setup: expected first-run setup to succeed'); }

    admin = new ApiClient(server.baseURL);
    if((await admin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD)).status !== 200)
    {
        throw new Error('setup: expected the admin sign-in to succeed');
    }

    // A fresh account, so its quota_limit is NULL -- the state that inherits the instance default.
    member = new ApiClient(server.baseURL);
    if((await member.signUp('member@fileshed.test', PASSWORD)).status !== 200)
    {
        throw new Error('setup: expected the member to sign up');
    }
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

async function patchSettings(changes : Record<string, unknown>) : Promise<Response>
{
    return admin.patch('/api/admin/settings', { changes });
}

async function claimFixture() : Promise<Response>
{
    return member.post('/api/blobs/claim', { sha256: sha, size: data.length });
}

async function publishedLimits() : Promise<InstanceLimits>
{
    const res = await new ApiClient(server.baseURL).get('/api/instance');

    return (await res.json() as { limits : InstanceLimits }).limits;
}

//----------------------------------------------------------------------------------------------------------------------

describe('DEFAULT_QUOTA_BYTES over the wire', () =>
{
    // The other key is put out of the way first: the fixture is larger than either cap, so a standing UPLOAD_MAX_BYTES
    // would refuse this claim on size before quota ever spoke. Stated here rather than inherited from a sibling
    // describe, so this block still proves what it claims when run alone or reordered.
    beforeAll(async () =>
    {
        expect((await patchSettings({ UPLOAD_MAX_BYTES: null })).status).toBe(200);
    });

    it('caps an account with no limit of its own, then releases it when returned to unlimited', async () =>
    {
        expect((await patchSettings({ DEFAULT_QUOTA_BYTES: 1024 })).status).toBe(200);

        const refused = await claimFixture();
        expect(refused.status).toBe(403);
        expect(((await refused.json() as { error : string }).error).toLowerCase()).toContain('quota');

        // 0 is the unlimited sentinel and the shipped default, so this patch resets the key rather than storing a row.
        expect((await patchSettings({ DEFAULT_QUOTA_BYTES: 0 })).status).toBe(200);

        const admitted = await claimFixture();
        expect(admitted.status).toBe(200);
        expect((await admitted.json() as ClaimResponse).upload).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('UPLOAD_MAX_BYTES over the wire', () =>
{
    // Quota is admitted before size is measured, so a standing DEFAULT_QUOTA_BYTES would turn the 413 below into a
    // 403. Released here rather than inherited from a sibling describe, so this block still proves what it claims
    // when run alone or reordered.
    beforeAll(async () =>
    {
        expect((await patchSettings({ DEFAULT_QUOTA_BYTES: 0 })).status).toBe(200);
    });

    it('refuses a claim for a file larger than the cap, and admits it once the cap is raised back', async () =>
    {
        expect((await patchSettings({ UPLOAD_MAX_BYTES: 1024 })).status).toBe(200);

        expect((await claimFixture()).status).toBe(413);
        expect(await publishedLimits()).toMatchObject({ uploadMaxBytes: 1024 });

        expect((await patchSettings({ UPLOAD_MAX_BYTES: null })).status).toBe(200);

        expect((await claimFixture()).status).toBe(200);
    });

    // The bound is the server's, so a client that ignores the published constraints still cannot store a cap that
    // would refuse every upload on the instance.
    it('refuses a cap of zero with a 400 naming the key, leaving the standing cap untouched', async () =>
    {
        const before = await publishedLimits();

        const res = await patchSettings({ UPLOAD_MAX_BYTES: 0 });

        expect(res.status).toBe(400);
        expect((await res.json() as { error : string }).error).toContain('UPLOAD_MAX_BYTES');
        expect(await publishedLimits()).toEqual(before);
    });
});

//----------------------------------------------------------------------------------------------------------------------
