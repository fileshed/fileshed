//----------------------------------------------------------------------------------------------------------------------
// User Resource Access
//
// A narrow read/write surface over BetterAuth's `user` table for the columns FileShed's app layer touches outside an
// auth round trip: the per-user byte quota, and the preferences blob. The quota read exists because a write charged to
// an owner who is NOT the acting caller -- an editor replacing content in a file shared to them -- must judge quota
// against the OWNER's authoritative limit, which the caller's session snapshot cannot supply. The preferences read is
// fresh-from-row on purpose: the session cookie cache would lag a just-saved preference, so /api/me reads the row.
//----------------------------------------------------------------------------------------------------------------------

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';

//----------------------------------------------------------------------------------------------------------------------

// The stored blob decoded to a plain object. Null (no preferences set), non-JSON, or a non-object payload all read as
// an empty blob rather than throwing -- a read of the profile never fails on a hand-edited or future-versioned column.
function decodePreferences(stored : string | null) : Record<string, unknown>
{
    if(stored === null) { return {}; }

    try
    {
        const parsed : unknown = JSON.parse(stored);
        if(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
        {
            return parsed as Record<string, unknown>;
        }
    }
    catch { /* fall through to the empty blob */ }

    return {};
}

//----------------------------------------------------------------------------------------------------------------------

export class UserRA
{
    readonly #db : DatabaseHandle['db'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
    }

    // The per-user byte cap (null = unlimited) straight from the user row. A missing user reads as null (unlimited),
    // but node ownership carries a real FK to user.id, so an owner looked up here always exists.
    async quotaLimitOf(userID : string) : Promise<number | null>
    {
        const row = await this.#db
            .selectFrom('user')
            .select('quota_limit')
            .where('id', '=', userID)
            .executeTakeFirst();

        return row?.quota_limit ?? null;
    }

    // The raw preferences blob straight from the row -- every key it carries, known and unknown. The merge on a write
    // reads this, so an older client's write preserves the unknown keys a newer client stored.
    async preferencesOf(userID : string) : Promise<Record<string, unknown>>
    {
        const row = await this.#db
            .selectFrom('user')
            .select('preferences')
            .where('id', '=', userID)
            .executeTakeFirst();

        return decodePreferences(row?.preferences ?? null);
    }

    // Replace the stored blob wholesale. The caller has already merged, so this persists the full object verbatim --
    // unknown keys included.
    async setPreferences(userID : string, preferences : Record<string, unknown>) : Promise<void>
    {
        await this.#db
            .updateTable('user')
            .set({ preferences: JSON.stringify(preferences) })
            .where('id', '=', userID)
            .execute();
    }
}

//----------------------------------------------------------------------------------------------------------------------
