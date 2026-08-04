//----------------------------------------------------------------------------------------------------------------------
// Auth Secret Resolution
//
// What an operator gets for each way of supplying (or not supplying) the key that signs sessions and seals stored
// settings: a generated file on a fresh install, the same file forever after, a refusal when a file they named is
// missing, and a migration of everything sealed under the old key whenever a new one takes over.
//
// The log lines are part of the contract here -- a cleared secret and a lingering AUTH_SECRET_PREVIOUS have no
// other outward sign -- so this file captures the logger rather than mocking anything the manager talks to.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AdminSettingKey } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const { warnings } = vi.hoisted(() => ({ warnings: [] as string[] }));

vi.mock('@server/utils/logger.ts', () =>
{
    const record = (...args : unknown[]) : void =>
    {
        warnings.push(args.map((arg) =>
        {
            return typeof arg === 'string' ? arg : JSON.stringify(arg);
        }).join(' '));
    };

    const noop = () : void => { /* the specs only read warnings */ };
    const logger = {
        warn: record,
        info: noop,
        error: noop,
        debug: noop,
        trace: noop,
        fatal: noop,
        child: () => logger,
    };

    return { getLogger: () => logger };
});

// Managers
import { type AuthSecretDeps, resolveAuthSecret } from '@server/managers/authSecret.ts';

// Resource Access
import { SettingsRA } from '@server/resource-access/settings/index.ts';

// Utils
import { SecretBox } from '@server/utils/secretBox.ts';

// Support
import { ORIGIN, bootFullApp, makeAdmin, testConfig } from '../auth/support.ts';
import { openTestDatabase } from '../support/database.ts';

//----------------------------------------------------------------------------------------------------------------------

const ENVIRONMENT_SECRET = 'environment-auth-secret-0123456789ab';
const RETIRED_SECRET = 'retired-auth-secret-0123456789abcdef';
const MOUNTED_SECRET = 'mounted-auth-secret-0123456789abcdef';

const SMTP_PASSWORD = 'smtp-password-hunter2';

const disposals : (() => Promise<void>)[] = [];

let dataDir : string;
let managedFile : string;

beforeEach(async () =>
{
    warnings.length = 0;
    dataDir = await mkdtemp(join(tmpdir(), 'fileshed-auth-secret-'));
    managedFile = join(dataDir, 'auth-secret');
});

afterEach(async () =>
{
    await Promise.all(disposals.splice(0).map((dispose) => dispose()));
    await rm(dataDir, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

function deps(settings : SettingsRA, overrides : Partial<AuthSecretDeps> = {}) : AuthSecretDeps
{
    return {
        managedFile,
        configuredFile: null,
        environment: null,
        previous: null,
        discardSealedSecrets: false,
        settings,
        ...overrides,
    };
}

// A database with no schema at all -- what the resolver actually meets on a first boot, since it runs before the
// migrations that create the settings table.
async function unmigratedSettings() : Promise<SettingsRA>
{
    const { handle, dispose } = await openTestDatabase(testConfig());
    disposals.push(dispose);

    return new SettingsRA(handle);
}

// A migrated database, for the cases about stored settings surviving (or not surviving) a change of key.
async function migratedSettings() : Promise<SettingsRA>
{
    const booted = await bootFullApp();
    disposals.push(() => booted.handle.db.destroy());

    return new SettingsRA(booted.handle);
}

async function sealInto(settings : SettingsRA, key : AdminSettingKey, value : string, secret : string)
: Promise<void>
{
    await settings.upsert(key, new SecretBox(secret).seal(value));
}

async function opened(settings : SettingsRA, key : AdminSettingKey, secret : string) : Promise<string | null>
{
    const stored = await settings.get(key);

    return typeof stored === 'string' ? new SecretBox(secret).open(stored) : null;
}

async function exists(path : string) : Promise<boolean>
{
    try
    {
        await stat(path);
        return true;
    }
    catch { return false; }
}

//----------------------------------------------------------------------------------------------------------------------
// Generation
//----------------------------------------------------------------------------------------------------------------------

describe('resolveAuthSecret on a fresh install', () =>
{
    it('generates 32 random bytes into a file only its owner can read', async () =>
    {
        const settings = await unmigratedSettings();

        const secret = await resolveAuthSecret(deps(settings));

        expect(Buffer.from(secret, 'base64')).toHaveLength(32);
        expect((await readFile(managedFile, 'utf8')).trim()).toBe(secret);
        expect((await stat(managedFile)).mode & 0o777).toBe(0o600);
    });

    it('reuses the file it generated instead of minting another', async () =>
    {
        const settings = await unmigratedSettings();

        const first = await resolveAuthSecret(deps(settings));
        const second = await resolveAuthSecret(deps(settings));

        expect(second).toBe(first);
    });

    // Two processes starting against one empty data directory must not walk away signing with different keys.
    it('converges on a single secret when several resolutions race', async () =>
    {
        const settings = await unmigratedSettings();

        const resolved = await Promise.all([
            resolveAuthSecret(deps(settings)),
            resolveAuthSecret(deps(settings)),
            resolveAuthSecret(deps(settings)),
        ]);

        const onDisk = (await readFile(managedFile, 'utf8')).trim();

        expect(new Set(resolved)).toEqual(new Set([ onDisk ]));
    });

    it('generates against a database whose settings table does not exist yet', async () =>
    {
        const settings = await unmigratedSettings();

        await expect(resolveAuthSecret(deps(settings))).resolves.toEqual(expect.any(String));
    });

    it('generates at the path the deployment configured when it is the managed one', async () =>
    {
        const settings = await unmigratedSettings();

        const secret = await resolveAuthSecret(deps(settings, { configuredFile: managedFile }));

        expect((await readFile(managedFile, 'utf8')).trim()).toBe(secret);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// A file the operator named
//----------------------------------------------------------------------------------------------------------------------

describe('resolveAuthSecret with AUTH_SECRET_FILE', () =>
{
    it('reads the named file ahead of AUTH_SECRET and writes nothing of its own', async () =>
    {
        const settings = await unmigratedSettings();
        const mounted = join(dataDir, 'mounted-secret');
        await writeFile(mounted, `${ MOUNTED_SECRET }\n`);

        const secret = await resolveAuthSecret(deps(settings, {
            configuredFile: mounted,
            environment: ENVIRONMENT_SECRET,
        }));

        expect(secret).toBe(MOUNTED_SECRET);
        expect(await exists(managedFile)).toBe(false);
    });

    // A secret mount is read-only by design, so a missing one is a deployment that is not ready -- inventing a
    // replacement would sign sessions with a key the operator never chose.
    it('refuses to start when the named file is missing, naming it and the managed alternative', async () =>
    {
        const settings = await unmigratedSettings();
        const absent = join(dataDir, 'never-mounted');

        await expect(resolveAuthSecret(deps(settings, { configuredFile: absent })))
            .rejects.toThrow(new RegExp(`AUTH_SECRET_FILE.+${ absent }`, 's'));
        expect(await exists(managedFile)).toBe(false);
    });

    it('refuses to start when the named file cannot be read', async () =>
    {
        const settings = await unmigratedSettings();
        const unreadable = join(dataDir, 'unreadable-secret');
        await writeFile(unreadable, `${ MOUNTED_SECRET }\n`);
        await chmod(unreadable, 0o000);

        await expect(resolveAuthSecret(deps(settings, { configuredFile: unreadable })))
            .rejects.toThrow(/AUTH_SECRET_FILE/);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Taking over from the managed file
//----------------------------------------------------------------------------------------------------------------------

describe('resolveAuthSecret when an operator takes control', () =>
{
    it('re-seals stored settings under the new key and retires the managed file', async () =>
    {
        const settings = await migratedSettings();
        await writeFile(managedFile, `${ RETIRED_SECRET }\n`);
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, RETIRED_SECRET);

        const secret = await resolveAuthSecret(deps(settings, { environment: ENVIRONMENT_SECRET }));

        expect(secret).toBe(ENVIRONMENT_SECRET);
        expect(await opened(settings, 'SMTP_PASSWORD', ENVIRONMENT_SECRET)).toBe(SMTP_PASSWORD);
        expect(await exists(managedFile)).toBe(false);
    });

    // Copying the generated value into AUTH_SECRET is the zero-disruption takeover: custody moves, nothing rotates.
    it('transfers custody without touching stored settings when the value is the same', async () =>
    {
        const settings = await migratedSettings();
        await writeFile(managedFile, `${ RETIRED_SECRET }\n`);
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, RETIRED_SECRET);
        const before = await settings.get('SMTP_PASSWORD');

        await resolveAuthSecret(deps(settings, { environment: RETIRED_SECRET }));

        expect(await settings.get('SMTP_PASSWORD')).toBe(before);
        expect(await exists(managedFile)).toBe(false);
    });

    // The migration deletes the retired file last, so a process killed mid-flight leaves some values moved and
    // some not. The next boot judges each one by the key that opens it and finishes the job.
    it('finishes a takeover that was interrupted before the file was retired', async () =>
    {
        const settings = await migratedSettings();
        await writeFile(managedFile, `${ RETIRED_SECRET }\n`);
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, ENVIRONMENT_SECRET);
        await sealInto(settings, 'GITHUB_CLIENT_SECRET', 'gh-client-secret', RETIRED_SECRET);

        await resolveAuthSecret(deps(settings, { environment: ENVIRONMENT_SECRET }));

        expect(await opened(settings, 'SMTP_PASSWORD', ENVIRONMENT_SECRET)).toBe(SMTP_PASSWORD);
        expect(await opened(settings, 'GITHUB_CLIENT_SECRET', ENVIRONMENT_SECRET)).toBe('gh-client-secret');
        expect(await exists(managedFile)).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Rotating one environment value for another
//----------------------------------------------------------------------------------------------------------------------

describe('resolveAuthSecret with AUTH_SECRET_PREVIOUS', () =>
{
    it('moves stored settings from the previous key to the new one', async () =>
    {
        const settings = await migratedSettings();
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, RETIRED_SECRET);

        await resolveAuthSecret(deps(settings, {
            environment: ENVIRONMENT_SECRET,
            previous: RETIRED_SECRET,
        }));

        expect(await opened(settings, 'SMTP_PASSWORD', ENVIRONMENT_SECRET)).toBe(SMTP_PASSWORD);
    });

    it('asks for it to be removed once nothing needs it', async () =>
    {
        const settings = await migratedSettings();
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, ENVIRONMENT_SECRET);

        await resolveAuthSecret(deps(settings, {
            environment: ENVIRONMENT_SECRET,
            previous: RETIRED_SECRET,
        }));

        expect(warnings.join('\n')).toMatch(/AUTH_SECRET_PREVIOUS is set and nothing needed it/);
    });
});

//----------------------------------------------------------------------------------------------------------------------
// Settings no key opens
//
// The invariant these cases hold to: FileShed deletes a stored setting only when the operator has set
// FILESHED_DISCARD_SEALED_SECRETS. Any other boot that meets a value it cannot open ends without writing anything.
//----------------------------------------------------------------------------------------------------------------------

describe('resolveAuthSecret when a key is unrecoverable', () =>
{
    // The rotation someone meant to be lossless: a new AUTH_SECRET, and the old one never handed over. The value
    // that opens these settings is usually still in a secret store, so the boot ends and leaves them alone.
    it('refuses a rotation that never supplied the old key, and keeps the settings', async () =>
    {
        const settings = await migratedSettings();
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, RETIRED_SECRET);
        const before = await settings.get('SMTP_PASSWORD');

        await expect(resolveAuthSecret(deps(settings, { environment: ENVIRONMENT_SECRET })))
            .rejects.toThrow(/rotation without the old key/);
        expect(await settings.get('SMTP_PASSWORD')).toBe(before);
    });

    // The same mistake with a typo in it: AUTH_SECRET_PREVIOUS set, but not to the value that sealed them.
    it('refuses when AUTH_SECRET_PREVIOUS holds the wrong value', async () =>
    {
        const settings = await migratedSettings();
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, RETIRED_SECRET);

        await expect(resolveAuthSecret(deps(settings, {
            environment: ENVIRONMENT_SECRET,
            previous: 'not-the-key-that-sealed-anything-0123',
        }))).rejects.toThrow(/SMTP_PASSWORD.+AUTH_SECRET_PREVIOUS.+FILESHED_DISCARD_SEALED_SECRETS/s);
        expect(await settings.get('SMTP_PASSWORD')).toBeDefined();
    });

    // Generating a fresh key over settings sealed under a lost one destroys them. Refusing hands the operator the
    // restore they still might have.
    it('refuses to generate over sealed settings, naming them and the way out', async () =>
    {
        const settings = await migratedSettings();
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, RETIRED_SECRET);

        await expect(resolveAuthSecret(deps(settings)))
            .rejects.toThrow(/SMTP_PASSWORD.+FILESHED_DISCARD_SEALED_SECRETS/s);
        expect(await exists(managedFile)).toBe(false);
        expect(await settings.get('SMTP_PASSWORD')).toBeDefined();
    });

    it('names the managed file in the refusal, so the operator knows what to restore', async () =>
    {
        const settings = await migratedSettings();
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, RETIRED_SECRET);

        await expect(resolveAuthSecret(deps(settings))).rejects.toThrow(new RegExp(managedFile, 's'));
    });

    it('clears them on a rotation once the operator asks for the discarding boot', async () =>
    {
        const settings = await migratedSettings();
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, RETIRED_SECRET);

        const secret = await resolveAuthSecret(deps(settings, {
            environment: ENVIRONMENT_SECRET,
            discardSealedSecrets: true,
        }));

        expect(secret).toBe(ENVIRONMENT_SECRET);
        expect(await settings.get('SMTP_PASSWORD')).toBeUndefined();
        expect(warnings.join('\n')).toMatch(/Cleared stored settings.+SMTP_PASSWORD/s);
    });

    it('starts and clears them when the discarding boot has no key of its own either', async () =>
    {
        const settings = await migratedSettings();
        await sealInto(settings, 'SMTP_PASSWORD', SMTP_PASSWORD, RETIRED_SECRET);

        const secret = await resolveAuthSecret(deps(settings, { discardSealedSecrets: true }));

        expect(Buffer.from(secret, 'base64')).toHaveLength(32);
        expect(await settings.get('SMTP_PASSWORD')).toBeUndefined();
    });
});

//----------------------------------------------------------------------------------------------------------------------
// The admin surface
//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/admin/settings', () =>
{
    it('never carries the key the instance signs with', async () =>
    {
        const booted = await bootFullApp();
        disposals.push(() => booted.handle.db.destroy());

        const secret = await resolveAuthSecret(deps(new SettingsRA(booted.handle)));
        const cookie = await makeAdmin(booted, 'admin@example.com', 'correct-horse-battery');

        const res = await booted.app.request(`${ ORIGIN }/api/admin/settings`, { headers: { cookie } });

        expect(res.status).toBe(200);
        expect(await res.text()).not.toContain(secret);
    });
});

//----------------------------------------------------------------------------------------------------------------------
