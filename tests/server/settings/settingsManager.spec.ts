//----------------------------------------------------------------------------------------------------------------------
// Settings Manager — override-over-config resolution and the admin patch surface
//
// The contract: the loaded config IS the default for every config-backed key and the vocabulary's fallback covers
// the settings-only ones; an admin override in the database beats either, applies to the very next read, and a null
// patch deletes it -- "reset to default" is the absence of a row. Values must fit their key's declared kind, and
// the whole admin surface is admin-only.
//----------------------------------------------------------------------------------------------------------------------

import { beforeEach, describe, expect, it } from 'vitest';

import { BadRequestError, ForbiddenError } from '@fileshed/core';

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
});

//----------------------------------------------------------------------------------------------------------------------
