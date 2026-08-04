//----------------------------------------------------------------------------------------------------------------------
// E2E — The session secret across real restarts
//
// A container started with nothing must come up on its own, keep the same key across restarts, and hand that key
// over to an operator who later sets AUTH_SECRET without losing what it sealed. Three real children over one data
// directory prove it: a session survives the restart that reuses the key, and an SMTP password stored through the
// admin API survives the one that replaces it.
//
// The children get AUTH_SECRET='', which the config loader reads as unset exactly like an absent variable.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Support
import { ApiClient, type ServerHandle, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const NO_SECRET = { AUTH_SECRET: '' };
const TAKEOVER_SECRET = 'operator-chosen-auth-secret-0123456789';

const SETUP_TOKEN = 'e2e-secret-setup-token-1234';
const ADMIN_EMAIL = 'admin@fileshed.test';
const ADMIN_PASSWORD = 'admin-password-e2e';

const SMTP_PASSWORD = 'e2e-smtp-password-9quz';

let server : ServerHandle;

// What the story produced, captured as it happened: the assertions read these rather than re-running a flow whose
// whole point is the order it happened in.
let generatedSecret : string;
let fileMode : number;
let secretAfterRestart : string;
let profileAfterRestart : number;
let maskBeforeTakeover : unknown;
let maskAfterTakeover : unknown;
let secretFileAfterTakeover : boolean;

function secretPath(handle : ServerHandle) : string
{
    return join(handle.dataDir, 'auth-secret');
}

async function readSecretFile(handle : ServerHandle) : Promise<string>
{
    return (await readFile(secretPath(handle), 'utf8')).trim();
}

async function secretFileExists(handle : ServerHandle) : Promise<boolean>
{
    try
    {
        await stat(secretPath(handle));
        return true;
    }
    catch { return false; }
}

async function adminClient(handle : ServerHandle) : Promise<ApiClient>
{
    const client = new ApiClient(handle.baseURL);
    const signIn = await client.signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
    if(signIn.status !== 200) { throw new Error(`admin sign-in: expected 200, got ${ signIn.status }`); }

    return client;
}

// The masked SMTP password the admin surface reports. It only has a mask to show while the stored value still
// opens, which is what makes it an honest witness to the migration.
async function smtpPasswordEntry(handle : ServerHandle) : Promise<unknown>
{
    const client = await adminClient(handle);
    const res = await client.get('/api/admin/settings');
    const body = await res.json() as { settings : { key : string; value : unknown }[] };

    return body.settings.find((entry) => entry.key === 'SMTP_PASSWORD')?.value;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    // First boot: no secret anywhere. The server generates one, and an admin seals an SMTP password under it.
    server = await spawnServer({ env: { ...NO_SECRET, FILESHED_SETUP_TOKEN: SETUP_TOKEN } });

    const setup = await new ApiClient(server.baseURL).post('/api/setup', {
        token: SETUP_TOKEN,
        name: 'Administrator',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
    });
    if(setup.status !== 200) { throw new Error(`setup: expected 200, got ${ setup.status }`); }

    const patch = await (await adminClient(server)).patch('/api/admin/settings', { changes: { SMTP_PASSWORD } });
    if(patch.status !== 200) { throw new Error(`settings patch: expected 200, got ${ patch.status }`); }

    generatedSecret = await readSecretFile(server);
    fileMode = (await stat(secretPath(server))).mode & 0o777;

    // A session cookie minted before the restart, in the form a browser sends it back.
    const member = new ApiClient(server.baseURL);
    const signUp = await member.signUp('member@example.com', 'correct-horse-battery');
    if(signUp.status !== 200) { throw new Error(`sign-up: expected 200, got ${ signUp.status }`); }

    const sessionCookie = signUp.headers.getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; ');

    const dirs = { dataDir: server.dataDir, storageRoot: server.storageRoot };
    await server.stop({ keep: true });

    // Second boot, same data, still no secret in the environment: the key is reused, so the cookie still verifies.
    server = await spawnServer({ env: NO_SECRET, dirs });
    secretAfterRestart = await readSecretFile(server);
    profileAfterRestart = (await fetch(`${ server.baseURL }/api/me`, {
        headers: { cookie: sessionCookie, origin: server.baseURL },
    })).status;
    maskBeforeTakeover = await smtpPasswordEntry(server);

    await server.stop({ keep: true });

    // Third boot: the operator supplies their own AUTH_SECRET. The stored SMTP password moves to it, and the
    // generated file is retired.
    server = await spawnServer({ env: { AUTH_SECRET: TAKEOVER_SECRET }, dirs });
    secretFileAfterTakeover = await secretFileExists(server);
    maskAfterTakeover = await smtpPasswordEntry(server);
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

describe('a server booted with no AUTH_SECRET', () =>
{
    it('generates 32 random bytes into a file only its owner can read', () =>
    {
        expect(Buffer.from(generatedSecret, 'base64')).toHaveLength(32);
        expect(fileMode).toBe(0o600);
    });

    it('keeps the same secret across a restart on the same data', () =>
    {
        expect(secretAfterRestart).toBe(generatedSecret);
    });

    it('still accepts a session cookie minted before the restart', () =>
    {
        expect(profileAfterRestart).toBe(200);
    });
});

describe('a server whose operator takes the secret over', () =>
{
    it('retires the generated file once AUTH_SECRET supplies the key', () =>
    {
        expect(secretFileAfterTakeover).toBe(false);
    });

    it('carries the stored SMTP password across to the new key', () =>
    {
        expect(maskBeforeTakeover).toBe(`••••${ SMTP_PASSWORD.slice(-4) }`);
        expect(maskAfterTakeover).toBe(maskBeforeTakeover);
    });
});

//----------------------------------------------------------------------------------------------------------------------
