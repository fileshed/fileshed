//----------------------------------------------------------------------------------------------------------------------
// First-Run Setup — the one-time code, the live zero-user gate, and the admin it mints
//
// The contract: while no account exists, setup is open and gated by a code the operator proves possession of (the
// boot-generated one, or their own FILESHED_SETUP_TOKEN); a wrong code is a 401 that reveals nothing; the right
// code creates exactly one account, already an admin; and the instant ANY account exists -- created here or by any
// other means -- setup answers not-found forever, from a live check. Codes are freshly generated per manager (per
// boot), so a code that leaked in a pasted log is stale after any restart.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

import { NotFoundError, UnauthorizedError } from '@fileshed/core';

// Resource Access
import { UserRA } from '@server/resource-access/users/index.ts';

// Managers
import { SetupManager } from '@server/managers/setup.ts';

// Support
import { type BootedApp, bootTestApp, signUp } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

function makeSetup(booted : BootedApp, operatorToken : string | null = null) : SetupManager
{
    return new SetupManager({
        auth: booted.auth,
        handle: booted.handle,
        users: new UserRA(booted.handle),
        operatorToken,
    });
}

function request(token : string) : { token : string; name : string; email : string; password : string }
{
    return { token, name: 'Administrator', email: 'owner@example.com', password: 'correct-horse-battery' };
}

//----------------------------------------------------------------------------------------------------------------------

describe('SetupManager', () =>
{
    it('opens on an empty instance and mints the first account as an admin', async () =>
    {
        const booted = await bootTestApp();
        const setup = makeSetup(booted);

        expect(await setup.needsSetup()).toBe(true);

        const result = await setup.complete(request(setup.code));
        expect(result.email).toBe('owner@example.com');

        const rows = await booted.handle.db
            .selectFrom('user')
            .select([ 'email', 'role' ])
            .execute();
        expect(rows).toEqual([ { email: 'owner@example.com', role: 'admin' } ]);
        expect(await setup.needsSetup()).toBe(false);
    });

    it('rejects a wrong code without revealing anything, leaving setup open', async () =>
    {
        const booted = await bootTestApp();
        const setup = makeSetup(booted);

        await expect(setup.complete(request('not-the-code'))).rejects.toThrow(UnauthorizedError);
        expect(await setup.needsSetup()).toBe(true);
    });

    it('answers not-found forever once ANY account exists, even with the right code', async () =>
    {
        const booted = await bootTestApp();
        const setup = makeSetup(booted);

        // An account created by any other path -- not by setup -- still closes the surface: the check is live.
        await signUp(booted.app, 'someone@example.com', 'correct-horse-battery');

        expect(await setup.needsSetup()).toBe(false);
        await expect(setup.complete(request(setup.code))).rejects.toThrow(NotFoundError);
    });

    it('accepts the operator\'s own token when the environment provides one', async () =>
    {
        const booted = await bootTestApp();
        const setup = makeSetup(booted, 'operator-chosen-token');

        expect(setup.code).toBe('operator-chosen-token');
        const result = await setup.complete(request('operator-chosen-token'));

        expect(result.email).toBe('owner@example.com');
    });

    it('generates a fresh code per boot, so a leaked code goes stale on restart', async () =>
    {
        const booted = await bootTestApp();

        const first = makeSetup(booted);
        const second = makeSetup(booted);

        expect(first.code).not.toBe(second.code);
        expect(first.code).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
    });

    it('lets exactly one of two concurrent completions win', async () =>
    {
        const booted = await bootTestApp();
        const setup = makeSetup(booted);

        const outcomes = await Promise.allSettled([
            setup.complete(request(setup.code)),
            setup.complete({ ...request(setup.code), email: 'rival@example.com' }),
        ]);

        const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
        expect(fulfilled).toHaveLength(1);

        const rows = await booted.handle.db.selectFrom('user').select('email')
            .execute();
        expect(rows).toHaveLength(1);
    });
});

//----------------------------------------------------------------------------------------------------------------------
