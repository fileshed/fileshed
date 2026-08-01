//----------------------------------------------------------------------------------------------------------------------
// Ban Engine — standing derived from the flag plus its expiry
//----------------------------------------------------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';

// Engines
import { effectiveBan } from '@server/engines/ban.ts';

//----------------------------------------------------------------------------------------------------------------------

const now = new Date('2026-08-01T12:00:00.000Z');

describe('effectiveBan', () =>
{
    it('reads a never-banned account as clean', () =>
    {
        const ban = effectiveBan({ banned: false, banReason: null, banExpires: null }, now);

        expect(ban).toEqual({ banned: false, banReason: null, banExpires: null });
    });

    it('holds an undated ban until an explicit unban', () =>
    {
        const facts = { banned: true, banReason: 'spamming', banExpires: null };

        expect(effectiveBan(facts, now)).toEqual(facts);
    });

    it('holds a dated ban while its expiry is still ahead', () =>
    {
        const facts = { banned: true, banReason: 'spamming', banExpires: new Date('2026-08-02T12:00:00.000Z') };

        expect(effectiveBan(facts, now)).toEqual(facts);
    });

    it('reads a lapsed ban as a clean record, reason and expiry included', () =>
    {
        const facts = { banned: true, banReason: 'spamming', banExpires: new Date('2026-07-30T12:00:00.000Z') };

        expect(effectiveBan(facts, now)).toEqual({ banned: false, banReason: null, banExpires: null });
    });

    it('treats a ban as over the moment its expiry arrives', () =>
    {
        const facts = { banned: true, banReason: 'spamming', banExpires: new Date(now) };

        expect(effectiveBan(facts, now).banned).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------
