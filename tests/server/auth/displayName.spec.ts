//----------------------------------------------------------------------------------------------------------------------
// Display Name Bound
//
// `name` is better-auth's own column, not one of our additionalFields, so no codec in this project ever sees it and
// the hundred-character limit our own surfaces enforce never reaches sign-up. The bound is a database hook rather
// than a check on the sign-up route for the same reason the token cleanup is: a hook fires on the row operation, so
// a provider's first login and any sign-up surface added later are covered without anyone enumerating endpoints.
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Models
import { DISPLAY_NAME_MAX_LENGTH } from '@fileshed/core';

// Test support
import { bootTestApp, signUp } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

async function storedNameOf(booted : Awaited<ReturnType<typeof bootTestApp>>, email : string) : Promise<string>
{
    const row = await booted.handle.db
        .selectFrom('user')
        .select('name')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return row.name;
}

//----------------------------------------------------------------------------------------------------------------------

describe('display name at sign-up', () =>
{
    it('bounds a name no surface of ours validates', async () =>
    {
        const booted = await bootTestApp();

        const res = await signUp(booted.app, 'long@example.com', 'correct-horse-battery', 'n'.repeat(5000));

        expect(res.status).toBe(200);
        expect(await storedNameOf(booted, 'long@example.com')).toHaveLength(DISPLAY_NAME_MAX_LENGTH);
    });

    // The two bounds are independent and the outer one is coarser: a name in the megabytes never reaches the hook
    // because the body carrying it is refused unread. Worth pinning both, since either alone leaves a gap -- the
    // body limit lets a five-thousand-character name through, and the hook never sees a body nobody parsed.
    it('refuses a name too large to be a request body at all, before anything reads it', async () =>
    {
        const booted = await bootTestApp();

        const res = await signUp(booted.app, 'huge@example.com', 'correct-horse-battery', 'n'.repeat(2_000_000));

        expect(res.status).toBe(413);
    });

    it('leaves a name within the bound exactly as it was given', async () =>
    {
        const booted = await bootTestApp();

        await signUp(booted.app, 'short@example.com', 'correct-horse-battery', '  Ada Lovelace  ');

        // Trimmed, because surrounding whitespace is not a name, but otherwise untouched -- this is a bound, not a
        // normalizer, and a display name is the user's to choose.
        expect(await storedNameOf(booted, 'short@example.com')).toBe('Ada Lovelace');
    });
});

//----------------------------------------------------------------------------------------------------------------------
