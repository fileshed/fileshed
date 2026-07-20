//----------------------------------------------------------------------------------------------------------------------
// Auth — first-run admin bootstrap
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Resource Access
import { bootstrapAdmin } from '@server/resource-access/boot.ts';

// Support
import { type BootedApp, bootTestApp } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

const ADMIN = { FILESHED_ADMIN_EMAIL: 'owner@example.com', FILESHED_ADMIN_PASSWORD: 'correct-horse-battery' };

async function usersWithEmail(booted : BootedApp, email : string) : Promise<{ role : string }[]>
{
    return booted.handle.db
        .selectFrom('user')
        .select([ 'role' ])
        .where('email', '=', email)
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------

describe('bootstrapAdmin', () =>
{
    it('creates exactly one admin when the env pair is set', async () =>
    {
        const booted = await bootTestApp(ADMIN);

        const rows = await usersWithEmail(booted, ADMIN.FILESHED_ADMIN_EMAIL);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.role).toBe('admin');
    });

    it('is idempotent across a second boot — no duplicate, still admin', async () =>
    {
        const booted = await bootTestApp(ADMIN);

        // Second boot against the same database: migrations already applied, bootstrap runs again.
        await bootstrapAdmin(booted.handle, booted.auth, booted.config);

        const rows = await usersWithEmail(booted, ADMIN.FILESHED_ADMIN_EMAIL);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.role).toBe('admin');
    });

    it('creates no admin when the env pair is absent', async () =>
    {
        const booted = await bootTestApp();

        const all = await booted.handle.db.selectFrom('user').select([ 'id' ])
            .execute();

        expect(all).toHaveLength(0);
    });

    // boot.ts's contract: a crash between the sign-up and the promotion heals on the next boot -- the existing
    // non-admin account for the configured email gets promoted instead of re-created.
    it('promotes an existing non-admin account for the configured email', async () =>
    {
        const booted = await bootTestApp();
        await booted.auth.api.signUpEmail({
            body: {
                email: ADMIN.FILESHED_ADMIN_EMAIL,
                name: 'Crashed Mid-Bootstrap',
                password: ADMIN.FILESHED_ADMIN_PASSWORD,
            },
        });

        await bootstrapAdmin(booted.handle, booted.auth, { ...booted.config, ...ADMIN });

        const rows = await usersWithEmail(booted, ADMIN.FILESHED_ADMIN_EMAIL);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.role).toBe('admin');
    });

    // better-auth lowercases emails on sign-up; a mixed-case configured address must still find its own row on later
    // boots instead of re-attempting the sign-up.
    it('handles a mixed-case configured email across boots', async () =>
    {
        const mixedCase = {
            FILESHED_ADMIN_EMAIL: 'Owner@Example.com',
            FILESHED_ADMIN_PASSWORD: 'correct-horse-battery',
        };
        const booted = await bootTestApp(mixedCase);

        await bootstrapAdmin(booted.handle, booted.auth, { ...booted.config, ...mixedCase });

        const rows = await usersWithEmail(booted, 'owner@example.com');

        expect(rows).toHaveLength(1);
        expect(rows[0]?.role).toBe('admin');
    });
});

//----------------------------------------------------------------------------------------------------------------------
