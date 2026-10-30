//----------------------------------------------------------------------------------------------------------------------
// AuthRA -- better-auth refusals
//
// better-auth refuses with its own error class; what a manager receives is the core error for that refusal's status,
// or a plain null/false where the refusal only means the thing is not there. Driven against a real instance, so each
// refusal is one better-auth actually raises.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Models
import { ACCESS_TOKEN_CONFIG_PAT, BadRequestError, NotFoundError, UnauthorizedError } from '@fileshed/core';

// Resource Access
import { AuthRA } from '@server/resource-access/auth/index.ts';

// Support
import { type BootedApp, bootTestApp, makeAdmin, signUp } from '../../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedApp;
let ra : AuthRA;
let adminHeaders : Headers;
let targetID : string;

beforeEach(async () =>
{
    booted = await bootTestApp();
    ra = new AuthRA(booted.auth, booted.handle);

    adminHeaders = new Headers({ cookie: await makeAdmin(booted, 'admin@example.com', 'correct-horse-battery') });

    await signUp(booted.app, 'target@example.com', 'correct-horse-battery');
    const target = await booted.handle.db.selectFrom('user').select('id')
        .where('email', '=', 'target@example.com')
        .executeTakeFirstOrThrow();
    targetID = target.id;
});

afterEach(async () =>
{
    await booted.handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('AuthRA refusals', () =>
{
    it('turns a refused request into a BadRequestError carrying better-auth\'s message', async () =>
    {
        const refusal = ra.setPassword(adminHeaders, targetID, 'short');

        await expect(refusal).rejects.toBeInstanceOf(BadRequestError);
        await expect(refusal).rejects.toThrow(/password/i);
    });

    it('turns a call with no session behind it into an UnauthorizedError', async () =>
    {
        await expect(ra.listKeys(new Headers(), ACCESS_TOKEN_CONFIG_PAT)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('names the missing user when an admin mutation targets an unknown id', async () =>
    {
        const refusal = ra.unban(adminHeaders, 'no-such-user');

        await expect(refusal).rejects.toBeInstanceOf(NotFoundError);
        await expect(refusal).rejects.toThrow('No user no-such-user.');
    });

    it('reports a key the session user does not hold as absent', async () =>
    {
        expect(await ra.deleteKey(adminHeaders, 'no-such-key', ACCESS_TOKEN_CONFIG_PAT)).toBe(false);
    });

    it('answers a token nobody minted with no verified key', async () =>
    {
        expect(await ra.verifyKey('fs_pat_nobody-minted-this', ACCESS_TOKEN_CONFIG_PAT)).toBeNull();
    });
});

//----------------------------------------------------------------------------------------------------------------------
