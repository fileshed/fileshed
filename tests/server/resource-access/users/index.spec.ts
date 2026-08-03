//----------------------------------------------------------------------------------------------------------------------
// User Resource Access — account headcounts and the admin listing
//
// Real database through the real boot path (better-auth owns the user table's schema), raw row writes for the
// states the API cannot mint on demand: a backdated signup and a lapsed ban.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Constants
import { MS_PER_DAY } from '@fileshed/core';

// Resource Access
import { type AdminUserListOptions, UserRA } from '@server/resource-access/users/index.ts';

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

// The listing's defaults, so a test spells out only the option it is about.
function listing(overrides : Partial<AdminUserListOptions> = {}) : AdminUserListOptions
{
    return { limit: 50, offset: 0, searchField: 'email', sortDirection: 'asc', ...overrides };
}

async function backdate(booted : BootedApp, email : string, createdAt : Date) : Promise<void>
{
    await booted.handle.db.updateTable('user')
        .set({ createdAt: createdAt.toISOString() })
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
// The admin listing
//----------------------------------------------------------------------------------------------------------------------

describe('UserRA.listUsers — search', () =>
{
    // The headline: an admin typing a capitalized address finds the account that holds it. Matching on the stored
    // text alone answers this differently per deployment -- SQLite's LIKE ignores ASCII case, Postgres's does not.
    it('matches an email whatever case the search was typed in', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'bob@example.com', PASSWORD, 'Bob');
        await signUp(booted.app, 'alice@example.com', PASSWORD, 'Alice');

        const page = await new UserRA(booted.handle).listUsers(listing({ search: 'Bob@' }));

        expect(page.users.map((user) => user.email)).toEqual([ 'bob@example.com' ]);
        expect(page.total).toBe(1);
    });

    it('matches a name whatever case the search was typed in', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'ada@example.com', PASSWORD, 'Ada Lovelace');
        await signUp(booted.app, 'grace@example.com', PASSWORD, 'Grace Hopper');

        const page = await new UserRA(booted.handle)
            .listUsers(listing({ search: 'ADA LOVE', searchField: 'name' }));

        expect(page.users.map((user) => user.name)).toEqual([ 'Ada Lovelace' ]);
    });

    // Contains, not starts-with: the fragment can sit anywhere in the value.
    it('matches a fragment from the middle of the value', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'bob@example.com', PASSWORD, 'Bob');
        await signUp(booted.app, 'carol@other.test', PASSWORD, 'Carol');

        const page = await new UserRA(booted.handle).listUsers(listing({ search: 'xamp' }));

        expect(page.users.map((user) => user.email)).toEqual([ 'bob@example.com' ]);
    });

    // A search is text to look for, not a pattern to run: someone hunting for "100%" wants the account carrying that
    // text, not every account there is.
    it('treats a wildcard character in the search as literal text', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'cotton@example.com', PASSWORD, '100% Cotton');
        await signUp(booted.app, 'blend@example.com', PASSWORD, '100 Percent Blend');

        const page = await new UserRA(booted.handle)
            .listUsers(listing({ search: '100%', searchField: 'name' }));

        expect(page.users.map((user) => user.name)).toEqual([ '100% Cotton' ]);
    });

    it('counts every match, not just the ones on the page', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'one@example.com', PASSWORD, 'One');
        await signUp(booted.app, 'two@example.com', PASSWORD, 'Two');
        await signUp(booted.app, 'three@example.com', PASSWORD, 'Three');
        await signUp(booted.app, 'four@other.test', PASSWORD, 'Four');

        const page = await new UserRA(booted.handle)
            .listUsers(listing({ search: 'example.com', limit: 2 }));

        expect(page.users).toHaveLength(2);
        expect(page.total).toBe(3);
    });
});

describe('UserRA.listUsers — ordering and paging', () =>
{
    it('sorts by email in the requested direction', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'bbb@example.com', PASSWORD, 'Bee');
        await signUp(booted.app, 'aaa@example.com', PASSWORD, 'Aye');
        await signUp(booted.app, 'ccc@example.com', PASSWORD, 'Cee');

        const ra = new UserRA(booted.handle);
        const asc = await ra.listUsers(listing({ sortBy: 'email' }));
        const desc = await ra.listUsers(listing({ sortBy: 'email', sortDirection: 'desc' }));

        expect(asc.users.map((user) => user.email))
            .toEqual([ 'aaa@example.com', 'bbb@example.com', 'ccc@example.com' ]);
        expect(desc.users.map((user) => user.email))
            .toEqual([ 'ccc@example.com', 'bbb@example.com', 'aaa@example.com' ]);
    });

    it('sorts by name', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'one@example.com', PASSWORD, 'Zoe');
        await signUp(booted.app, 'two@example.com', PASSWORD, 'Ada');
        await signUp(booted.app, 'three@example.com', PASSWORD, 'Mia');

        const page = await new UserRA(booted.handle).listUsers(listing({ sortBy: 'name' }));

        expect(page.users.map((user) => user.name)).toEqual([ 'Ada', 'Mia', 'Zoe' ]);
    });

    it('sorts by the account-creation stamp', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'newest@example.com', PASSWORD, 'Newest');
        await signUp(booted.app, 'oldest@example.com', PASSWORD, 'Oldest');
        await signUp(booted.app, 'middle@example.com', PASSWORD, 'Middle');
        await backdate(booted, 'oldest@example.com', new Date('2026-01-01T00:00:00.000Z'));
        await backdate(booted, 'middle@example.com', new Date('2026-02-01T00:00:00.000Z'));
        await backdate(booted, 'newest@example.com', new Date('2026-03-01T00:00:00.000Z'));

        const page = await new UserRA(booted.handle).listUsers(listing({ sortBy: 'createdAt' }));

        expect(page.users.map((user) => user.email))
            .toEqual([ 'oldest@example.com', 'middle@example.com', 'newest@example.com' ]);
    });

    // With no key asked for, the listing still has to come back in SOME defined order, or a page boundary would be
    // free to repeat or drop an account. Account age is that order -- the order the accounts arrived in.
    it('falls back to account age when no sort key is asked for', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'third@example.com', PASSWORD, 'Third');
        await signUp(booted.app, 'first@example.com', PASSWORD, 'First');
        await signUp(booted.app, 'second@example.com', PASSWORD, 'Second');
        await backdate(booted, 'first@example.com', new Date('2026-01-01T00:00:00.000Z'));
        await backdate(booted, 'second@example.com', new Date('2026-02-01T00:00:00.000Z'));
        await backdate(booted, 'third@example.com', new Date('2026-03-01T00:00:00.000Z'));

        const page = await new UserRA(booted.handle).listUsers(listing());

        expect(page.users.map((user) => user.email))
            .toEqual([ 'first@example.com', 'second@example.com', 'third@example.com' ]);
    });

    // Accounts sharing a name tie on the sort key, and a tie the database is free to break either way makes paging
    // unsafe. Id settles it, ascending.
    it('breaks a tie on the sort key by id', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'one@example.com', PASSWORD, 'Sam');
        await signUp(booted.app, 'two@example.com', PASSWORD, 'Sam');
        await signUp(booted.app, 'three@example.com', PASSWORD, 'Sam');

        const page = await new UserRA(booted.handle).listUsers(listing({ sortBy: 'name' }));
        const ids = page.users.map((user) => user.id);

        expect(ids).toEqual([ ...ids ].sort());
    });

    it('walks the whole listing across pages without repeating or dropping an account', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'aaa@example.com', PASSWORD, 'Aye');
        await signUp(booted.app, 'bbb@example.com', PASSWORD, 'Bee');
        await signUp(booted.app, 'ccc@example.com', PASSWORD, 'Cee');
        await signUp(booted.app, 'ddd@example.com', PASSWORD, 'Dee');
        await signUp(booted.app, 'eee@example.com', PASSWORD, 'Eee');

        const ra = new UserRA(booted.handle);
        const sort = { sortBy: 'email' as const, limit: 2 };
        const first = await ra.listUsers(listing({ ...sort, offset: 0 }));
        const second = await ra.listUsers(listing({ ...sort, offset: 2 }));
        const third = await ra.listUsers(listing({ ...sort, offset: 4 }));

        expect(first.users.map((user) => user.email)).toEqual([ 'aaa@example.com', 'bbb@example.com' ]);
        expect(second.users.map((user) => user.email)).toEqual([ 'ccc@example.com', 'ddd@example.com' ]);
        expect(third.users.map((user) => user.email)).toEqual([ 'eee@example.com' ]);
        expect(first.total).toBe(5);
    });
});

describe('UserRA.listUsers — rows', () =>
{
    // The two dialects store these differently -- 0/1 and ISO text on SQLite, real types on Postgres -- and the ban
    // engine that judges standing downstream reads one shape only.
    it('reads a stored ban as a boolean, its reason, and a real expiry date', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'banned@example.com', PASSWORD, 'Banned');
        const expires = new Date('2026-12-01T00:00:00.000Z');
        await booted.handle.db.updateTable('user')
            .set({ banned: 1, banReason: 'spamming', banExpires: expires.toISOString() })
            .where('email', '=', 'banned@example.com')
            .execute();

        const page = await new UserRA(booted.handle).listUsers(listing({ search: 'banned@' }));
        const [ row ] = page.users;

        expect(row?.banned).toBe(true);
        expect(row?.banReason).toBe('spamming');
        expect(row?.banExpires).toEqual(expires);
        expect(row?.createdAt).toBeInstanceOf(Date);
    });

    it('reads a never-banned account as a clean record', async () =>
    {
        const booted = await bootTestApp();
        await signUp(booted.app, 'clean@example.com', PASSWORD, 'Clean');

        const page = await new UserRA(booted.handle).listUsers(listing({ search: 'clean@' }));
        const [ row ] = page.users;

        expect(row?.banned).toBe(false);
        expect(row?.banReason).toBeNull();
        expect(row?.banExpires).toBeNull();
    });

    it('carries the account role and its raw quota cap', async () =>
    {
        const booted = await bootTestApp();
        await makeAdmin(booted, 'root@example.com', PASSWORD);
        await booted.handle.db.updateTable('user')
            // eslint-disable-next-line camelcase -- snake_case DB column (house convention for Kysely updates)
            .set({ quota_limit: 4096 })
            .where('email', '=', 'root@example.com')
            .execute();

        const page = await new UserRA(booted.handle).listUsers(listing({ search: 'root@' }));

        expect(page.users[0]?.role).toBe('admin');
        expect(page.users[0]?.quotaLimit).toBe(4096);
    });
});

//----------------------------------------------------------------------------------------------------------------------
