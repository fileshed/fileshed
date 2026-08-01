//----------------------------------------------------------------------------------------------------------------------
// Branding Manager — the theme document's lifecycle
//
// One JSON row, merged key-wise: a patch touches only the keys it names, an explicit null unsets, and keys this
// version does not know SURVIVE a patch untouched -- the forward-compat property the whole storage design exists
// for. Reads never throw, and the admin gate guards both the view and the write.
//----------------------------------------------------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BadRequestError, ForbiddenError, PayloadTooLargeError, defaultInstanceTheme } from '@fileshed/core';

// Resource Access
import { BlobRA } from '@server/resource-access/blob/index.ts';
import { SettingsRA } from '@server/resource-access/settings/index.ts';
import { seedDefaultBackend } from '@server/resource-access/database/seeds.ts';

// Managers
import { BrandingManager } from '@server/managers/branding.ts';

// Support
import { type BootedApp, bootTestApp } from '../auth/support.ts';
import { testActor } from '../nodes/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const admin = testActor({ id: 'admin1', role: 'admin' });
const civilian = testActor({ id: 'user1', role: 'user' });

let booted : BootedApp;
let ra : SettingsRA;
let manager : BrandingManager;

let storageRoot : string;

beforeEach(async () =>
{
    booted = await bootTestApp();
    storageRoot = await mkdtemp(join(tmpdir(), 'fileshed-branding-'));
    await seedDefaultBackend(booted.handle, { ...booted.config, STORAGE_ROOT: storageRoot });

    ra = new SettingsRA(booted.handle);
    manager = new BrandingManager({
        settings: ra,
        handle: booted.handle,
        blob: new BlobRA(booted.handle),
        maxBytes: async () => booted.config.AVATAR_MAX_BYTES,
    });
});

afterEach(async () =>
{
    await rm(storageRoot, { recursive: true, force: true });
});

//----------------------------------------------------------------------------------------------------------------------

describe('BrandingManager', () =>
{
    it('answers the stock theme when nothing is stored', async () =>
    {
        expect(await manager.theme()).toEqual(defaultInstanceTheme);
    });

    it('merges a patch key-wise: untouched knobs stay, explicit null unsets', async () =>
    {
        await manager.update(admin, { primary: '#3b82f6', radius: 0.5 });
        const afterSecond = await manager.update(admin, { radius: null, neutral: 'slate' });

        expect(afterSecond.primary).toBe('#3b82f6');
        expect(afterSecond.radius).toBeNull();
        expect(afterSecond.neutral).toBe('slate');
    });

    it('lets keys it does not know survive a patch -- the forward-compat contract', async () =>
    {
        await ra.upsert('BRANDING', { primary: '#112233', futureKnob: 'hold on to this' });

        await manager.update(admin, { radius: 0.25 });

        const raw = await ra.get('BRANDING') as Record<string, unknown>;
        expect(raw['futureKnob']).toBe('hold on to this');
        expect(raw['primary']).toBe('#112233');
        expect(raw['radius']).toBe(0.25);
    });

    it('collapses a hand-mangled row to stock instead of failing the read', async () =>
    {
        await ra.upsert('BRANDING', 'scribbles');

        expect(await manager.theme()).toEqual(defaultInstanceTheme);
    });

    it('guards both the admin view and the write', async () =>
    {
        await expect(manager.view(civilian)).rejects.toThrow(ForbiddenError);
        await expect(manager.update(civilian, { primary: '#3b82f6' })).rejects.toThrow(ForbiddenError);

        expect(await manager.theme()).toEqual(defaultInstanceTheme);
    });

    it('stores a logo content-addressed, replaces it with graveyarding, and deletes it clean', async () =>
    {
        const blob = new BlobRA(booted.handle);
        const first = Buffer.from('first-logo-bytes');
        const second = Buffer.from('second-logo-bytes');

        await manager.setLogo(admin, Readable.from(first), 'image/png', first.length);
        const firstSha = await manager.logoSha();
        expect(firstSha).not.toBeNull();

        const served = await manager.serveLogo();
        expect(served?.mime).toBe('image/png');
        expect(served?.size).toBe(first.length);

        // Replacing moves the reference and graveyards the orphan in one step.
        await manager.setLogo(admin, Readable.from(second), 'image/svg+xml', second.length);
        expect((await blob.get(firstSha ?? ''))?.deletedAt).not.toBeNull();

        await manager.deleteLogo(admin);
        expect(await manager.logoSha()).toBeNull();
        expect(await manager.serveLogo()).toBeNull();
    });

    it('never graveyards the logo blob from another reference dropping -- the pin holds', async () =>
    {
        const blob = new BlobRA(booted.handle);
        const bytes = Buffer.from('shared-logo-bytes');

        await manager.setLogo(admin, Readable.from(bytes), 'image/png', bytes.length);
        const sha = await manager.logoSha() ?? '';

        // Something else asks the graveyard question about this exact hash: the logo reference must answer it.
        await blob.graveyardUnreferenced([ sha ]);

        expect((await blob.get(sha))?.deletedAt).toBeNull();
        expect(await manager.serveLogo()).not.toBeNull();
    });

    it('refuses a non-image logo and an oversized one, storing nothing', async () =>
    {
        await expect(manager.setLogo(admin, Readable.from(Buffer.from('x')), 'text/html', 1))
            .rejects.toThrow(BadRequestError);

        const big = Buffer.alloc(booted.config.AVATAR_MAX_BYTES + 1);
        await expect(manager.setLogo(admin, Readable.from(big), 'image/png', undefined))
            .rejects.toThrow(PayloadTooLargeError);

        expect(await manager.logoSha()).toBeNull();
    });

    it('guards the logo writes behind the admin gate', async () =>
    {
        await expect(manager.setLogo(civilian, Readable.from(Buffer.from('x')), 'image/png', 1))
            .rejects.toThrow(ForbiddenError);
        await expect(manager.deleteLogo(civilian)).rejects.toThrow(ForbiddenError);
    });

    it('serves the stored theme and the custom CSS as one stylesheet', async () =>
    {
        await manager.update(admin, { primary: '#3b82f6', customCSS: '.x { color: red; }' });

        const css = await manager.css();

        expect(css).toContain('--ui-color-primary-500: #3b82f6;');
        expect(css).toContain('.x { color: red; }');
    });
});

//----------------------------------------------------------------------------------------------------------------------
