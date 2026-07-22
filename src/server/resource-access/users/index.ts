//----------------------------------------------------------------------------------------------------------------------
// User Resource Access
//
// A narrow read surface over BetterAuth's `user` table for the columns FileShed's app layer needs outside an auth
// round trip. Today that is one column: the per-user byte quota. It exists because a write charged to an owner who is
// NOT the acting caller -- an editor replacing content in a file shared to them -- must judge quota against the
// OWNER's authoritative limit, which the caller's session snapshot cannot supply.
//----------------------------------------------------------------------------------------------------------------------

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';

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
}

//----------------------------------------------------------------------------------------------------------------------
