//----------------------------------------------------------------------------------------------------------------------
// User Resource Access — account headcounts
//
// Real database through the real boot path (better-auth owns the user table's schema), raw row writes for the
// states the API cannot mint on demand: a backdated signup and a lapsed ban.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Constants
import { MS_PER_DAY } from '@fileshed/core';

// Resource Access
import { UserRA } from '@server/resource-access/users/index.ts';

// Support
import { type BootedApp, bootTestApp, makeAdmin, signUp } from '../../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery';

async function banRow(booted : BootedApp, email : string, banExpires : string | null) : Promise<void>
{
    await booted.handle.db.updateTable('user')
        .set({ banned: 1, banExpires })
        .where('email', '=', email)
        .execute();
}

//----------------------------------------------------------------------------------------------------------------------

describe('UserRA.counts', () =>
{
    it('splits totals, admins, and fresh signups on the caller\'s window boundary', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'old-timer@example.com', PASSWORD);
        await signUp(booted.app, 'newcomer@example.com', PASSWORD);
        await makeAdmin(booted, 'root@example.com', PASSWORD);
        await booted.handle.db.updateTable('user')
            .set({ createdAt: new Date(Date.now() - (30 * MS_PER_DAY)).toISOString() })
            .where('email', '=', 'old-timer@example.com')
            .execute();

        const counts = await new UserRA(booted.handle).counts(new Date(Date.now() - (7 * MS_PER_DAY)));

        expect(counts).toEqual({ total: 3, admins: 1, banned: 0, createdSince: 2 });
    });

    it('counts an undated ban and a ban with a future expiry, but not a lapsed one', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'undated@example.com', PASSWORD);
        await signUp(booted.app, 'future@example.com', PASSWORD);
        await signUp(booted.app, 'lapsed@example.com', PASSWORD);

        await banRow(booted, 'undated@example.com', null);
        await banRow(booted, 'future@example.com', new Date(Date.now() + MS_PER_DAY).toISOString());
        await banRow(booted, 'lapsed@example.com', new Date(Date.now() - MS_PER_DAY).toISOString());

        const counts = await new UserRA(booted.handle).counts(new Date(0));

        expect(counts.banned).toBe(2);
    });
});

//----------------------------------------------------------------------------------------------------------------------
