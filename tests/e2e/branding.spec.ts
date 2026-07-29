//----------------------------------------------------------------------------------------------------------------------
// E2E — Branding over a real server
//
// The whole loop a self-hoster lives: a fresh instance serves an empty stylesheet and stock facts; the admin
// saves a theme and an instance name; the very next ANONYMOUS requests -- the sign-in page's requests -- carry
// the ramp, the custom CSS, and the new name. No restart anywhere in the loop.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Support
import { ApiClient, type ServerHandle, sha256Of, spawnServer } from './support.ts';

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

describe('branding lifecycle', () =>
{
    it('serves an empty stylesheet and stock facts on a fresh instance', async () =>
    {
        const anonymous = new ApiClient(server.baseURL);

        const css = await anonymous.get('/api/branding.css');
        expect(css.status).toBe(200);
        expect(css.headers.get('content-type')).toContain('text/css');
        expect(await css.text()).toBe('');

        const instance = await anonymous.get('/api/instance');
        const body = await instance.json() as { branding : Record<string, unknown> };
        expect(body.branding).toEqual({ instanceName: 'FileShed', mode: 'system', forcedMode: false, logo: null });

        expect((await anonymous.get('/api/branding/logo')).status).toBe(404);
    });

    it('carries a saved theme and name to the very next anonymous requests', async () =>
    {
        const themed = await admin.patch('/api/admin/branding', {
            primary: '#0ea5e9',
            radius: 0.5,
            mode: 'dark',
            customCSS: '.wordmark { letter-spacing: 2px; }',
        });
        expect(themed.status).toBe(200);

        const renamed = await admin.patch('/api/admin/settings', {
            changes: { INSTANCE_NAME: 'Vale Files' },
        });
        expect(renamed.status).toBe(200);

        const anonymous = new ApiClient(server.baseURL);

        const css = await (await anonymous.get('/api/branding.css')).text();
        expect(css).toContain('--ui-color-primary-500: #0ea5e9;');
        expect(css).toContain('--ui-radius: 0.5rem;');
        expect(css).toContain('.wordmark { letter-spacing: 2px; }');

        const instance = await anonymous.get('/api/instance');
        const body = await instance.json() as { branding : Record<string, unknown> };
        expect(body.branding).toEqual({ instanceName: 'Vale Files', mode: 'dark', forcedMode: false, logo: null });
    });

    it('serves an uploaded logo to anonymous visitors and advertises its hash', async () =>
    {
        const bytes = Buffer.from('pretend-this-is-a-png');
        const uploaded = await admin.postBytes('/api/admin/branding/logo', bytes, 'image/png');
        expect(uploaded.status).toBe(200);

        const expectedSha = sha256Of(bytes);

        const anonymous = new ApiClient(server.baseURL);
        const instance = await anonymous.get('/api/instance');
        const body = await instance.json() as { branding : { logo : string | null } };
        expect(body.branding.logo).toBe(expectedSha);

        const served = await anonymous.get('/api/branding/logo');
        expect(served.status).toBe(200);
        expect(served.headers.get('content-type')).toBe('image/png');
        expect(Buffer.from(await served.arrayBuffer())).toEqual(bytes);
    });

    it('refuses the theme surface to non-admins while the stylesheet stays public', async () =>
    {
        const anonymous = new ApiClient(server.baseURL);

        expect((await anonymous.get('/api/admin/branding')).status).toBe(401);
        expect((await anonymous.patch('/api/admin/branding', { primary: '#112233' })).status).toBe(401);
        expect((await anonymous.get('/api/branding.css')).status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------
