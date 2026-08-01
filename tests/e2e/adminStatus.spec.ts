//----------------------------------------------------------------------------------------------------------------------
// E2E — Admin status reports real sweep data and a real overview
//
// The background sweeps run a boot pass, not just an interval tick, so the status page has real numbers shortly
// after startup -- on a real server, because that is where the timers actually get wired. Without the boot pass
// a deployment restarted more often than the interval never sweeps at all, and this page reads "never" forever.
//
// The overview rides the same response, and only a real server can prove the two halves of it that composition
// cannot: the version really is the shipped package's, and the sign-up switch really is being read from the settings
// store rather than assumed.
//----------------------------------------------------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Models
import type { AdminOverview } from '@fileshed/core';

// Support
import { ApiClient, type ServerHandle, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const ADMIN_EMAIL = 'admin@fileshed.test';
const ADMIN_PASSWORD = 'admin-password-e2e';

let server : ServerHandle;
let admin : ApiClient;

beforeAll(async () =>
{
    server = await spawnServer({ env: { FILESHED_SETUP_TOKEN: 'e2e-setup-token-1234' } });

    const setup = await new ApiClient(server.baseURL).post('/api/setup', {
        token: 'e2e-setup-token-1234',
        name: 'Admin',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
    });
    if(setup.status !== 200) { throw new Error('setup: expected first-run setup to succeed'); }

    admin = new ApiClient(server.baseURL);
    const signIn = await admin.signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    if(signIn.status !== 200) { throw new Error('setup: expected the admin sign-in to succeed'); }
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

interface SweepStatus
{
    ranAt : string;
    summary : Record<string, number>;
}

// Read straight from the workspace manifest rather than the server's own constant, so this pins the version a release
// would actually carry instead of agreeing with whatever the server computed.
function shippedVersion() : string
{
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as
        { version : string };

    return manifest.version;
}

describe('GET /api/admin/status after boot', () =>
{
    it('reports a completed GC and trash-purge sweep within moments of startup', async () =>
    {
        // The boot passes fire one second after the timers start; poll briefly rather than trusting one sleep.
        let body : { gc : SweepStatus | null; trashPurge : SweepStatus | null } | null = null;

        /* eslint-disable no-await-in-loop -- polling is sequential by nature */
        for(let attempt = 0; attempt < 20; attempt++)
        {
            const res = await admin.get('/api/admin/status');
            expect(res.status).toBe(200);

            body = await res.json() as typeof body;
            if(body?.gc !== null && body?.trashPurge !== null) { break; }

            await sleep(250);
        }
        /* eslint-enable no-await-in-loop */

        expect(body?.gc).not.toBeNull();
        expect(body?.gc?.ranAt).toBeTruthy();
        expect(body?.gc?.summary).toMatchObject({ candidates: 0, deleted: 0 });

        expect(body?.trashPurge).not.toBeNull();
        expect(body?.trashPurge?.summary).toMatchObject({ candidates: 0, purged: 0 });
    });

    it('counts the one account the setup wizard created and reports the shipped version', async () =>
    {
        const res = await admin.get('/api/admin/status');
        expect(res.status).toBe(200);

        const body = await res.json() as { overview : AdminOverview };

        expect(body.overview.users).toMatchObject({ total: 1, admins: 1, banned: 0 });
        expect(body.overview.instance.version).toBe(shippedVersion());
        expect(body.overview.instance.databaseKind).toBe('sqlite');

        // Nothing has touched the setting, so the readout must show the shipped default rather than a hardcoded guess.
        expect(body.overview.instance.signUpEnabled).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
