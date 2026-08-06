//----------------------------------------------------------------------------------------------------------------------
// Public Link Resource Access
//
// The query surface over the `public_link` table: mint a link, revoke it, list a node's links, and resolve a token.
// getByToken fetches regardless of revoked_at -- a revoked token still RESOLVES, to a dead link (the model's documented
// intent); the manager decides what a dead link serves. Ordering is by created_at, never by id (cuid2 is
// non-monotonic) -- id appears only as a tiebreak, where two links share a timestamp and the answer must not
// alternate between reads.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- insert values and where clauses name snake_case DB columns (house convention) */

import type { Selectable } from 'kysely';

// Models
import type { PublicLink } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle, PublicLinkTable } from '../database/database.ts';

//----------------------------------------------------------------------------------------------------------------------

// A stored timestamp reads back as a Date (Postgres) or an ISO string (SQLite); new Date normalizes both (database.ts).
function linkFromRow(row : Selectable<PublicLinkTable>) : PublicLink
{
    return {
        id: row.id,
        nodeID: row.node_id,
        token: row.token,
        createdAt: new Date(row.created_at),
        revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
    };
}

//----------------------------------------------------------------------------------------------------------------------

export class PublicLinkRA
{
    readonly #db : DatabaseHandle['db'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Reads
    //------------------------------------------------------------------------------------------------------------------

    async getByID(id : string) : Promise<PublicLink | undefined>
    {
        const row = await this.#db
            .selectFrom('public_link')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        return row === undefined ? undefined : linkFromRow(row);
    }

    // Resolve a token to its link REGARDLESS of revoked_at: a revoked token still resolves, to a dead link. The
    // manager reads revokedAt and decides what -- if anything -- a dead link serves.
    async getByToken(token : string) : Promise<PublicLink | undefined>
    {
        const row = await this.#db
            .selectFrom('public_link')
            .selectAll()
            .where('token', '=', token)
            .executeTakeFirst();

        return row === undefined ? undefined : linkFromRow(row);
    }

    // Every link on a node, live or revoked, oldest first -- the owner's link-management listing.
    async listByNode(nodeID : string) : Promise<PublicLink[]>
    {
        const rows = await this.#db
            .selectFrom('public_link')
            .selectAll()
            .where('node_id', '=', nodeID)
            .orderBy('created_at', 'asc')
            .execute();

        return rows.map(linkFromRow);
    }

    // The LIVE link on each of the given nodes, keyed by node id -- a whole listing page in one query. A revoked link
    // is dead and never answers here. Several live links on one node answer with the oldest, id breaking a same-
    // millisecond tie so the answer cannot alternate between reads.
    async liveLinksByNode(nodeIDs : readonly string[]) : Promise<Map<string, PublicLink>>
    {
        const links = new Map<string, PublicLink>();
        if(nodeIDs.length === 0) { return links; }

        const rows = await this.#db
            .selectFrom('public_link')
            .selectAll()
            .where('node_id', 'in', nodeIDs)
            .where('revoked_at', 'is', null)
            .orderBy('created_at', 'asc')
            .orderBy('id', 'asc')
            .execute();

        for(const row of rows)
        {
            const link = linkFromRow(row);
            if(!links.has(link.nodeID)) { links.set(link.nodeID, link); }
        }

        return links;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Writes
    //------------------------------------------------------------------------------------------------------------------

    async insert(link : PublicLink) : Promise<void>
    {
        await this.#db
            .insertInto('public_link')
            .values({
                id: link.id,
                node_id: link.nodeID,
                token: link.token,
                created_at: link.createdAt.toISOString(),
                revoked_at: link.revokedAt === null ? null : link.revokedAt.toISOString(),
            })
            .execute();
    }

    // Set revoked_at, but only on a still-live link -- the guard keeps a second revoke from moving the kill timestamp
    // (links are revocable). The manager has already checked ownership and existence.
    async revoke(id : string) : Promise<void>
    {
        await this.#db
            .updateTable('public_link')
            .set({ revoked_at: new Date().toISOString() })
            .where('id', '=', id)
            .where('revoked_at', 'is', null)
            .execute();
    }
}

//----------------------------------------------------------------------------------------------------------------------
