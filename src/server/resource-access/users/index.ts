//----------------------------------------------------------------------------------------------------------------------
// User Resource Access
//
// A narrow read/write surface over BetterAuth's `user` table for the columns FileShed's app layer touches outside an
// auth round trip: the per-user byte quota, the preferences blob, and the avatar reference. The quota read exists
// because a write charged to an owner who is NOT the acting caller -- an editor replacing content in a file shared to
// them -- must judge quota against the OWNER's authoritative limit, which the caller's session snapshot cannot supply.
// The preferences and avatar reads are fresh-from-row on purpose: the session cookie cache would lag a just-saved
// value, so /api/me reads the row.
//
// The admin listing reads here rather than through the auth plugin's own list endpoint, which matches its search
// case-sensitively on Postgres and offers no way to ask for anything else. Only the read moved: every account
// mutation still goes through the plugin, which owns the session and token side effects that ride along with one.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- update sets name snake_case DB columns (house convention for Kysely) */

import { type Expression, type Selectable, type SqlBool, sql } from 'kysely';

// Models
import type { AdminUserSearchField, AdminUserSortKey, UserRole, UserSummary } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle, UserTable } from '../database/database.ts';

// Utils
import { avatarImage } from '../../utils/avatarImage.ts';
import { escapeLikePattern } from '../../utils/likePattern.ts';

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

export interface UserCounts
{
    total : number;
    admins : number;
    banned : number;
    createdSince : number;
}

// One account as the admin listing reads it, with the dialect differences already settled: banned as a real boolean
// (SQLite stores 0/1) and the stamps as Dates (SQLite stores ISO text). Ban standing is NOT judged here -- the flag
// crosses as stored, and the ban engine decides what it means.
export interface AdminUserRow
{
    id : string;
    name : string;
    email : string;
    role : UserRole;
    quotaLimit : number | null;
    banned : boolean;
    banReason : string | null;
    banExpires : Date | null;
    createdAt : Date;
}

export interface AdminUserListing
{
    users : AdminUserRow[];
    total : number;
}

// A caller-supplied sort key never reaches orderBy as raw SQL: it names a column here or it does not sort at all, and
// a new key has to state which column it means. createdAt is one of better-auth's camelCase columns -- Kysely quotes
// it, which is what keeps Postgres from folding the identifier to lower case and losing it.
const userSortColumns : Record<AdminUserSortKey, 'name' | 'email' | 'createdAt'> = {
    name: 'name',
    email: 'email',
    createdAt: 'createdAt',
};

export interface AdminUserListOptions
{
    limit : number;
    offset : number;
    search ?: string;
    searchField : AdminUserSearchField;
    sortBy ?: AdminUserSortKey;
    sortDirection : 'asc' | 'desc';
}

// A substring match with BOTH sides folded: the stored value through lower(), the term in JS. SQLite's LIKE already
// ignores ASCII case where Postgres's does not, so an unfolded match answers the same search differently depending on
// which database is underneath -- `Bob@` finding nothing on one deployment and `bob@example.com` on the other. The
// term's own metacharacters are escaped, so a search for "50%" looks for that text rather than everything.
function searchCondition(field : AdminUserSearchField, term : string) : Expression<SqlBool>
{
    const pattern = `%${ escapeLikePattern(term.trim().toLowerCase()) }%`;

    return sql<SqlBool>`lower(${ sql.ref(field) }) like ${ pattern } escape '\\'`;
}

type AdminUserSelection = Pick<
    Selectable<UserTable>,
    'id' | 'name' | 'email' | 'role' | 'quota_limit' | 'banned' | 'banReason' | 'banExpires' | 'createdAt'
>;

// SQLite hands back 0/1 for a boolean column and ISO text for a timestamp; Postgres hands back the real types. Both
// arrive here, and only the domain shape leaves.
function adminUserRow(row : AdminUserSelection) : AdminUserRow
{
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        quotaLimit: row.quota_limit,
        banned: row.banned === true || row.banned === 1,
        banReason: row.banReason,
        banExpires: row.banExpires === null ? null : new Date(row.banExpires),
        createdAt: new Date(row.createdAt),
    };
}

//----------------------------------------------------------------------------------------------------------------------

export class UserRA
{
    readonly #db : DatabaseHandle['db'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
    }

    // Whether ANY account exists -- the first-run question. Live per call: the setup surface must vanish the
    // instant the first account lands, never a boot-time snapshot later.
    async anyUserExists() : Promise<boolean>
    {
        const row = await this.#db
            .selectFrom('user')
            .select('id')
            .limit(1)
            .executeTakeFirst();

        return row !== undefined;
    }

    // The account headcounts behind the admin overview, in one pass over the table. `since` is the caller's window
    // boundary for a fresh signup -- the RA has no opinion on how wide that window is. banned is null on accounts the
    // admin plugin has never touched, which the CASE reads as not banned; a dated ban past its expiry also reads as
    // not banned (the ban engine's standing rule, restated in SQL because the row keeps the stale flag until the
    // user's next sign-in). createdAt and banExpires need their quotes: better-auth emits those columns in
    // camelCase, and an unquoted mixed-case identifier folds to lower case on Postgres.
    async counts(since : Date) : Promise<UserCounts>
    {
        const cutoff = since.toISOString();
        const now = new Date().toISOString();
        const row = await this.#db
            .selectFrom('user')
            .select([
                sql<string | number>`count(*)`.as('total'),
                sql<string | number>`coalesce(sum(case when role = 'admin' then 1 else 0 end), 0)`.as('admins'),
                sql<string | number>`coalesce(sum(case when banned and ("banExpires" is null or "banExpires" > ${ now })
                        then 1 else 0 end), 0)`.as('banned'),
                sql<string | number>`coalesce(sum(case when "createdAt" >= ${ cutoff } then 1 else 0 end), 0)`
                    .as('created_since'),
            ])
            .executeTakeFirstOrThrow();

        return {
            total: Number(row.total),
            admins: Number(row.admins),
            banned: Number(row.banned),
            createdSince: Number(row.created_since),
        };
    }

    // One page of the admin user listing, plus the grand total the page was drawn from. Both run the same search
    // predicate, so the count and the page can never describe different sets. The requested sort key leads, then id
    // breaks ties -- without it a page boundary landing inside a run of equal names could repeat or drop an account.
    // With no key requested the listing falls back to account age, the order the accounts arrived in.
    async listUsers(options : AdminUserListOptions) : Promise<AdminUserListing>
    {
        const filter = options.search === undefined
            ? undefined
            : searchCondition(options.searchField, options.search);

        let page = this.#db
            .selectFrom('user')
            .select([ 'id', 'name', 'email', 'role', 'quota_limit', 'banned', 'banReason', 'banExpires', 'createdAt' ]);

        let counted = this.#db
            .selectFrom('user')
            .select((eb) => eb.fn.count('id').as('count'));

        if(filter !== undefined)
        {
            page = page.where(filter);
            counted = counted.where(filter);
        }

        // A direction with no key to apply it to is dropped, exactly as an unsorted listing has no direction.
        const sort = options.sortBy === undefined
            ? { column: 'createdAt' as const, direction: 'asc' as const }
            : { column: userSortColumns[options.sortBy], direction: options.sortDirection };

        const [ rows, total ] = await Promise.all([
            page
                .orderBy(sort.column, sort.direction)
                .orderBy('id', 'asc')
                .limit(options.limit)
                .offset(options.offset)
                .execute(),
            counted.executeTakeFirstOrThrow(),
        ]);

        return { users: rows.map(adminUserRow), total: Number(total.count) };
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

    // The display summary of the user whose email matches `email` exactly (case-insensitively), or undefined when no
    // account carries it. Whole-email match only -- never a prefix or substring -- so the share dialog's lookup can
    // confirm a grantee without becoming an account-enumeration oracle. Builds the UserSummary the same way the owner
    // facet does (avatarImage), so the avatar URL is derived identically on both paths.
    async findSummaryByEmail(email : string) : Promise<UserSummary | undefined>
    {
        const normalized = email.trim().toLowerCase();
        const row = await this.#db
            .selectFrom('user')
            .select([ 'id', 'name', 'email', 'avatar_sha256' ])
            .where(sql<SqlBool>`lower(email) = ${ normalized }`)
            .executeTakeFirst();

        if(row === undefined) { return undefined; }

        return {
            id: row.id,
            name: row.name,
            email: row.email,
            image: avatarImage(row.avatar_sha256),
        };
    }

    // The display summaries of every id in `userIDs`, keyed by id, in one query -- the owners-facet batching
    // precedent (NodeRA.ownersOf), so a grants list with N grantees costs one round trip rather than N.
    async summariesByIDs(userIDs : readonly string[]) : Promise<Map<string, UserSummary>>
    {
        const summaries = new Map<string, UserSummary>();
        if(userIDs.length === 0) { return summaries; }

        const rows = await this.#db
            .selectFrom('user')
            .select([ 'id', 'name', 'email', 'avatar_sha256' ])
            .where('id', 'in', userIDs)
            .execute();

        for(const row of rows)
        {
            const image = avatarImage(row.avatar_sha256);
            summaries.set(row.id, { id: row.id, name: row.name, email: row.email, image });
        }

        return summaries;
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

    // The sha256 of the user's avatar blob, or null when they have none. Read fresh from the row (not the session
    // snapshot) so /api/me reflects an avatar the same request just changed.
    async avatarSha256Of(userID : string) : Promise<string | null>
    {
        const row = await this.#db
            .selectFrom('user')
            .select('avatar_sha256')
            .where('id', '=', userID)
            .executeTakeFirst();

        return row?.avatar_sha256 ?? null;
    }

    // Point the user at a new avatar: its blob hash and the mime to serve it with. The caller has already stored the
    // bytes and their blob record; this only moves the reference.
    async setAvatar(userID : string, sha256 : string, mime : string) : Promise<void>
    {
        await this.#db
            .updateTable('user')
            .set({ avatar_sha256: sha256, avatar_mime: mime })
            .where('id', '=', userID)
            .execute();
    }

    // Drop the user's avatar reference. The old blob is graveyarded separately by the caller once the reference is
    // gone.
    async clearAvatar(userID : string) : Promise<void>
    {
        await this.#db
            .updateTable('user')
            .set({ avatar_sha256: null, avatar_mime: null })
            .where('id', '=', userID)
            .execute();
    }

    // The mime any user's avatar carries for this blob hash, or null when NO user references it as their avatar. This
    // is the authorization gate for serving avatar bytes: a hash no avatar points at reads as null, so the serve route
    // 404s rather than handing back arbitrary dedup-store content by hash. Identical bytes carry one mime, so any
    // referencing user's stored mime is the right one.
    async avatarMimeForSha(sha256 : string) : Promise<string | null>
    {
        const row = await this.#db
            .selectFrom('user')
            .select('avatar_mime')
            .where('avatar_sha256', '=', sha256)
            .executeTakeFirst();

        return row?.avatar_mime ?? null;
    }
}

//----------------------------------------------------------------------------------------------------------------------
