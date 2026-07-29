//----------------------------------------------------------------------------------------------------------------------
// E2E — OAuth providers frozen at boot
//
// A server booted with a complete provider pair advertises it on /api/instance -- the sign-in page's buttons come
// from exactly this list -- and registers the provider's OAuth doorway. A server booted with no pair advertises
// none. Both proven against real processes, because the freezing happens at boot and nowhere else.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Support
import { ApiClient, type ServerHandle, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

let withGithub : ServerHandle;
let without : ServerHandle;

beforeAll(async () =>
{
    [ withGithub, without ] = await Promise.all([
        spawnServer({ env: { GITHUB_CLIENT_ID: 'gh-e2e-id', GITHUB_CLIENT_SECRET: 'gh-e2e-secret' } }),
        spawnServer(),
    ]);
});

afterAll(async () =>
{
    await Promise.all([ withGithub?.stop(), without?.stop() ]);
});

//----------------------------------------------------------------------------------------------------------------------

describe('provider advertisement', () =>
{
    it('advertises a boot-configured provider on /api/instance', async () =>
    {
        const res = await new ApiClient(withGithub.baseURL).get('/api/instance');
        const body = await res.json() as { providers : string[] };

        expect(res.status).toBe(200);
        expect(body.providers).toEqual([ 'github' ]);
    });

    it('registers the provider sign-in doorway on the booted server', async () =>
    {
        const res = await new ApiClient(withGithub.baseURL).post('/api/auth/sign-in/social', {
            provider: 'github',
            callbackURL: `${ withGithub.baseURL }/`,
        });
        const body = await res.json() as { url ?: string };

        expect(res.status).toBe(200);
        expect(body.url).toContain('github.com');
    });

    it('advertises nothing on a server booted without providers, and refuses their doorway', async () =>
    {
        const instance = await new ApiClient(without.baseURL).get('/api/instance');
        expect(((await instance.json()) as { providers : string[] }).providers).toEqual([]);

        const res = await new ApiClient(without.baseURL).post('/api/auth/sign-in/social', {
            provider: 'github',
            callbackURL: `${ without.baseURL }/`,
        });
        expect(res.status).not.toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------
