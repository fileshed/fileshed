//----------------------------------------------------------------------------------------------------------------------
// Settings Manager — override-over-config resolution and the admin patch surface
//
// The contract: the loaded config IS the default for every config-backed key and the vocabulary's fallback covers
// the settings-only ones; an admin override in the database beats either, applies to the very next read, and a null
// patch deletes it -- "reset to default" is the absence of a row. Values must fit their key's declared kind, and
// the whole admin surface is admin-only.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';

import { BadRequestError, ForbiddenError, INSTANCE_NAME_MAX_LENGTH } from '@fileshed/core';

// Resource Access
import { SettingsRA } from '@server/resource-access/settings/index.ts';

// Managers
import { SettingsManager } from '@server/managers/settings.ts';

// Utils
import { SecretBox } from '@server/utils/secretBox.ts';

// Support
import { type BootedApp, bootTestApp } from '../auth/support.ts';
import { testActor } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const admin = testActor({ id: 'admin1', role: 'admin' });
const civilian = testActor({ id: 'user1', role: 'user' });

let booted : BootedApp;
let manager : SettingsManager;

beforeEach(async () =>
{
    booted = await bootTestApp();
    manager = new SettingsManager({
        settings: new SettingsRA(booted.handle),
        config: booted.config,
        box: new SecretBox(booted.config.AUTH_SECRET),
        startedAt: new Date(),
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('SettingsManager', () =>
{
    it('answers the config value for a config-backed key with no override', async () =>
    {
        expect(await manager.value('UPLOAD_MAX_BYTES')).toBe(booted.config.UPLOAD_MAX_BYTES);
        expect(await manager.numberValue('TRASH_PURGE_DAYS', -1)).toBe(booted.config.TRASH_PURGE_DAYS);
    });

    it('answers the vocabulary fallback for a settings-only key with no override', async () =>
    {
        expect(await manager.booleanValue('SIGN_UP_ENABLED', false)).toBe(true);
    });

    it('applies an admin override to the very next read', async () =>
    {
        await manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: 1024 } });

        expect(await manager.value('UPLOAD_MAX_BYTES')).toBe(1024);
    });

    it('reports each key with its source, default until overridden', async () =>
    {
        const before = await manager.adminView(admin);
        expect(before.settings.every((entry) => entry.source === 'default')).toBe(true);

        const after = await manager.patch(admin, { changes: { SIGN_UP_ENABLED: false } });
        const entry = after.settings.find((row) => row.key === 'SIGN_UP_ENABLED');

        expect(entry).toMatchObject({ value: false, source: 'override' });
    });

    it('marks whether a default lies beneath each key: config or fallback yes, bare provider keys no', async () =>
    {
        const view = await manager.adminView(admin);
        const byKey = new Map(view.settings.map((entry) => [ entry.key, entry ]));

        expect(byKey.get('UPLOAD_MAX_BYTES')?.hasDefault).toBe(true);
        expect(byKey.get('SIGN_UP_ENABLED')?.hasDefault).toBe(true);
        expect(byKey.get('GITLAB_CLIENT_ID')?.hasDefault).toBe(false);

        // An override on a defaultless key does not conjure a default -- there is still nothing to reset to.
        const after = await manager.patch(admin, { changes: { GITLAB_CLIENT_ID: 'gl-id' } });
        expect(after.settings.find((entry) => entry.key === 'GITLAB_CLIENT_ID')?.hasDefault).toBe(false);
    });

    it('reports a config-supplied provider credential as a real default', async () =>
    {
        const configured = new SettingsManager({
            settings: new SettingsRA(booted.handle),
            config: { ...booted.config, GITHUB_CLIENT_ID: 'gh-from-env' },
            box: new SecretBox(booted.config.AUTH_SECRET),
            startedAt: new Date(),
        });

        const view = await configured.adminView(admin);
        expect(view.settings.find((entry) => entry.key === 'GITHUB_CLIENT_ID')?.hasDefault).toBe(true);
    });

    it('treats storing the default value as a reset, never an override', async () =>
    {
        await manager.patch(admin, { changes: { INSTANCE_NAME: 'FileShed' } });

        const view = await manager.adminView(admin);
        const entry = view.settings.find((row) => row.key === 'INSTANCE_NAME');

        expect(entry).toMatchObject({ value: 'FileShed', source: 'default' });

        // And an existing override written back to the default disappears the same way.
        await manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: 1024 } });
        await manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: booted.config.UPLOAD_MAX_BYTES } });

        const after = await manager.adminView(admin);
        expect(after.settings.find((row) => row.key === 'UPLOAD_MAX_BYTES')?.source).toBe('default');
    });

    it('returns a key to its default when the override is patched to null', async () =>
    {
        await manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: 1024 } });

        const view = await manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: null } });
        const entry = view.settings.find((row) => row.key === 'UPLOAD_MAX_BYTES');

        expect(entry).toMatchObject({ value: booted.config.UPLOAD_MAX_BYTES, source: 'default' });
        expect(await manager.value('UPLOAD_MAX_BYTES')).toBe(booted.config.UPLOAD_MAX_BYTES);
    });

    it('rejects a value that does not fit the key\'s kind, storing nothing', async () =>
    {
        await expect(manager.patch(admin, { changes: { SIGN_UP_ENABLED: 5 } }))
            .rejects.toThrow(BadRequestError);

        expect(await manager.booleanValue('SIGN_UP_ENABLED', false)).toBe(true);
        const view = await manager.adminView(admin);
        expect(view.settings.find((row) => row.key === 'SIGN_UP_ENABLED')?.source).toBe('default');
    });

    it('rejects negative and fractional numbers -- caps and day counts are whole and non-negative', async () =>
    {
        await expect(manager.patch(admin, { changes: { TRASH_PURGE_DAYS: -1 } }))
            .rejects.toThrow(BadRequestError);
        await expect(manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: 1.5 } }))
            .rejects.toThrow(BadRequestError);

        expect(await manager.value('TRASH_PURGE_DAYS')).toBe(booted.config.TRASH_PURGE_DAYS);
        expect(await manager.value('UPLOAD_MAX_BYTES')).toBe(booted.config.UPLOAD_MAX_BYTES);
    });

    // A cap of zero bytes would refuse every upload and every avatar, leaving the instance broken in a way only
    // another admin visit undoes. The bound is the vocabulary's, so the error must name the key that violated it.
    it('rejects a cap below its floor, naming the key, storing nothing', async () =>
    {
        await expect(manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: 0 } }))
            .rejects.toThrow(/UPLOAD_MAX_BYTES/);
        await expect(manager.patch(admin, { changes: { AVATAR_MAX_BYTES: 0 } }))
            .rejects.toThrow(BadRequestError);

        expect(await manager.value('UPLOAD_MAX_BYTES')).toBe(booted.config.UPLOAD_MAX_BYTES);
        expect(await manager.value('AVATAR_MAX_BYTES')).toBe(booted.config.AVATAR_MAX_BYTES);
    });

    it('rejects an SMTP port outside the dialable range, at either end', async () =>
    {
        await expect(manager.patch(admin, { changes: { SMTP_PORT: 0 } })).rejects.toThrow(BadRequestError);
        await expect(manager.patch(admin, { changes: { SMTP_PORT: 65_536 } })).rejects.toThrow(BadRequestError);

        expect(await manager.value('SMTP_PORT')).toBe(booted.config.SMTP_PORT);
    });

    it('stores a value sitting exactly on its bound -- the bound is inclusive', async () =>
    {
        await manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: 1, SMTP_PORT: 65_535 } });

        expect(await manager.value('UPLOAD_MAX_BYTES')).toBe(1);
        expect(await manager.value('SMTP_PORT')).toBe(65_535);
    });

    it('rejects an instance name past its length cap, storing nothing', async () =>
    {
        await expect(manager.patch(admin, { changes: { INSTANCE_NAME: 'n'.repeat(INSTANCE_NAME_MAX_LENGTH + 1) } }))
            .rejects.toThrow(BadRequestError);

        expect(await manager.value('INSTANCE_NAME')).toBe('FileShed');

        const atCap = 'n'.repeat(INSTANCE_NAME_MAX_LENGTH);
        await manager.patch(admin, { changes: { INSTANCE_NAME: atCap } });
        expect(await manager.value('INSTANCE_NAME')).toBe(atCap);
    });

    // Reset is the absence of a row, so it must not be dragged through the bounds check: a default that happens to
    // sit outside them (or a key whose floor is above zero) would otherwise become impossible to reset.
    it('still resets a bounded key to its default rather than judging the default against the bounds', async () =>
    {
        await manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: 4096 } });

        const view = await manager.patch(admin, { changes: { UPLOAD_MAX_BYTES: null } });

        expect(view.settings.find((row) => row.key === 'UPLOAD_MAX_BYTES')?.source).toBe('default');
        expect(await manager.value('UPLOAD_MAX_BYTES')).toBe(booted.config.UPLOAD_MAX_BYTES);
    });

    // The admin UI hints and pre-validates from these, so they must ride out with each entry rather than being
    // duplicated client-side, where they would drift from the server that actually enforces them.
    it('publishes each key\'s bounds with its entry, and none where the key has none', async () =>
    {
        const byKey = new Map((await manager.adminView(admin)).settings.map((entry) => [ entry.key, entry ]));

        expect(byKey.get('UPLOAD_MAX_BYTES')?.constraints).toEqual({ min: 1 });
        expect(byKey.get('SMTP_PORT')?.constraints).toEqual({ min: 1, max: 65_535 });
        expect(byKey.get('INSTANCE_NAME')?.constraints).toEqual({ maxLength: INSTANCE_NAME_MAX_LENGTH });
        expect(byKey.get('SIGN_UP_ENABLED')?.constraints).toBeUndefined();
    });

    it('refuses the admin surface to a non-admin', async () =>
    {
        await expect(manager.adminView(civilian)).rejects.toThrow(ForbiddenError);
        await expect(manager.patch(civilian, { changes: { SIGN_UP_ENABLED: false } }))
            .rejects.toThrow(ForbiddenError);

        expect(await manager.booleanValue('SIGN_UP_ENABLED', false)).toBe(true);
    });

    it('does not flag a restart for keys that apply live', async () =>
    {
        const view = await manager.patch(admin, {
            changes: { UPLOAD_MAX_BYTES: 1024, SIGN_UP_ENABLED: false },
        });

        expect(view.restartRequired).toBe(false);
    });

    it('flags a restart once a restart-tier key changes, until a restart absorbs it', async () =>
    {
        function managerStartedAt(startedAt : Date) : SettingsManager
        {
            return new SettingsManager({
                settings: new SettingsRA(booted.handle),
                config: booted.config,
                box: new SecretBox(booted.config.AUTH_SECRET),
                startedAt,
            });
        }

        // A process that booted before the change sees it as pending; one that booted after (a restart) sees the
        // same row as settled history.
        const runningSinceEarlier = managerStartedAt(new Date(Date.now() - 60_000));
        const view = await runningSinceEarlier.patch(admin, { changes: { EMAIL_VERIFICATION_REQUIRED: true } });
        expect(view.restartRequired).toBe(true);

        const restarted = managerStartedAt(new Date(Date.now() + 60_000));
        expect((await restarted.adminView(admin)).restartRequired).toBe(false);
    });

    it(
        'boot reads prefer a stored override, fall back to the given default, and never leak an empty string',
        async () =>
        {
            expect(await manager.stringValueAtBoot('GITHUB_CLIENT_ID', 'env-id')).toBe('env-id');

            await manager.patch(admin, { changes: { GITHUB_CLIENT_ID: 'settings-id' } });
            expect(await manager.stringValueAtBoot('GITHUB_CLIENT_ID', 'env-id')).toBe('settings-id');
        }
    );

    it('boot reads answer the fallback instead of failing when the settings table does not exist yet', async () =>
    {
        // A first boot reads before the migrations run; model it with a database that never migrated.
        const { createDatabase } = await import('@server/resource-access/database/database.ts');
        const bare = createDatabase(booted.config);
        const unmigrated = new SettingsManager({
            settings: new SettingsRA(bare),
            config: booted.config,
            box: new SecretBox(booted.config.AUTH_SECRET),
            startedAt: new Date(),
        });

        expect(await unmigrated.stringValueAtBoot('GITHUB_CLIENT_ID', 'env-id')).toBe('env-id');
        expect(await unmigrated.booleanValueAtBoot('EMAIL_VERIFICATION_REQUIRED', false)).toBe(false);

        await bare.db.destroy();
    });

    it('masks a stored secret in the admin view -- the plaintext never crosses the wire again', async () =>
    {
        const view = await manager.patch(admin, { changes: { SMTP_PASSWORD: 'hunter2-smtp-secret' } });
        const entry = view.settings.find((row) => row.key === 'SMTP_PASSWORD');

        expect(entry?.value).toBe('••••cret');
        expect(entry?.source).toBe('override');
        expect(await manager.value('SMTP_PASSWORD')).toBe('hunter2-smtp-secret');
    });
});

//----------------------------------------------------------------------------------------------------------------------
