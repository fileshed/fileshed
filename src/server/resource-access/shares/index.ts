//----------------------------------------------------------------------------------------------------------------------
// Share Resource Access
//
// The query surface over the `share` and `share_request` tables, and -- the point of the whole layer -- the permission
// resolver every authenticated request leans on: effectiveRole(user, node) as the max of ownership, a direct grant, and
// any inherited grant, in one recursive walk. A batch variant resolves a page of nodes in a single round trip so
// children listings never fan out into N+1 queries.
//
// The resolver walks parent edges only, never target_node_id, so a link never conducts permission: a share on a folder
// that contains a link grants nothing on that link's target, because the target is resolved against its OWN real
// ancestor chain, which the shared folder is not part of. Ownership is checked at every node in the chain, not only the
// leaf, so a folder owner keeps access to the cross-owner contributions placed inside it. Both walks are one query in
// Kysely, identical on Postgres and SQLite.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- queries and the CTE column list name snake_case DB columns (house convention) */

import { sql } from 'kysely';

// Models
import {
    MAX_TREE_DEPTH,
    type NodeType,
    type PendingShareRequest,
    type ResolvedShareRequestStatus,
    type Role,
    type Share,
    type ShareRequest,
    type ShareRole,
    maxRole,
} from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';
import {
    rowFromPendingShareRequest,
    rowFromShare,
    shareFromRow,
    shareRequestFromRow,
} from './transforms.ts';

//----------------------------------------------------------------------------------------------------------------------
// Types
//----------------------------------------------------------------------------------------------------------------------

// Enough of a share's target to render it in the Shared with me listing. mimeType/size are present only for
// a file target; a share is never on a link (judgeGrant rejects it), so type is file|folder in practice.
export interface SharedTargetSummary
{
    id : string;
    type : NodeType;
    name : string;
    ownerID : string;
    mimeType ?: string;
    size ?: number;
}

// One active share granted to the caller, with its target summary and whether the caller has placed a link to it --
// placement is independent of the grant. `updatedAt` is the target's last-modified time, carried alongside the
// wire-shaped summary rather than inside it, so the caller's Modified filter has a value to test without widening the
// wire target.
export interface SharedWithMeRow
{
    share : Share;
    target : SharedTargetSummary;
    updatedAt : Date;
    placed : boolean;
}

//----------------------------------------------------------------------------------------------------------------------

// EXISTS reads back as a real boolean on Postgres and 0/1 on SQLite; Boolean spans both.
function toBool(value : unknown) : boolean
{
    return Boolean(value);
}

//----------------------------------------------------------------------------------------------------------------------

export class ShareRA
{
    readonly #db : DatabaseHandle['db'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Permission resolution
    //------------------------------------------------------------------------------------------------------------------

    // The caller's effective role on one node: the strongest of ownership (of the node or any ancestor), a direct
    // grant, and any grant inherited from an ancestor -- or null when they have none (no access).
    async effectiveRole(userID : string, nodeID : string) : Promise<Role | null>
    {
        return (await this.effectiveRoles(userID, [ nodeID ])).get(nodeID) ?? null;
    }

    // The batch resolver: the caller's effective role on each of `nodeIDs`, keyed by node id, in ONE query (resolution
    // runs on every request, so a children page must not fan out). Each requested node seeds its own ancestor chain in
    // a recursive CTE; grants are left-joined along every chain node, and ownership + grant strength are
    // folded per root in application code so the role ordering lives in exactly one place (core's maxRole). A node
    // absent from the result maps to null.
    async effectiveRoles(userID : string, nodeIDs : readonly string[]) : Promise<Map<string, Role | null>>
    {
        const roles = new Map<string, Role | null>();
        if(nodeIDs.length === 0) { return roles; }

        // Seed every asked-for node to null, so one with neither ownership nor a grant resolves to "no access" rather
        // than dropping out of the map.
        for(const id of nodeIDs) { roles.set(id, null); }

        const rows = await this.#db
            .withRecursive('access_chain(root, id, owner_id, parent_id, depth)', (qc) => qc
                .selectFrom('node')
                .select([ sql<string>`id`.as('root'), 'id', 'owner_id', 'parent_id', sql<number>`0`.as('depth') ])
                .where('id', 'in', nodeIDs)
                .unionAll(qc
                    .selectFrom('node as ancestor')
                    .innerJoin('access_chain', 'access_chain.parent_id', 'ancestor.id')
                    // Cycle backstop: a loop in the parent edges should be impossible, but this query runs on every
                    // authenticated request, so one corrupt edge must bound the walk rather than spin it.
                    .where('access_chain.depth', '<', MAX_TREE_DEPTH)
                    .select([
                        'access_chain.root',
                        'ancestor.id',
                        'ancestor.owner_id',
                        'ancestor.parent_id',
                        sql<number>`access_chain.depth + 1`.as('depth'),
                    ])))
            .selectFrom('access_chain')
            .leftJoin('share', (join) => join
                .onRef('share.node_id', '=', 'access_chain.id')
                .on('share.grantee_user_id', '=', userID))
            .select([
                sql<string>`access_chain.root`.as('root'),
                sql<string>`access_chain.owner_id`.as('owner_id'),
                'share.role as role',
            ])
            .execute();

        for(const row of rows)
        {
            const ownership : Role | null = row.owner_id === userID ? 'owner' : null;
            const combined = maxRole(maxRole(roles.get(row.root) ?? null, ownership), row.role ?? null);
            roles.set(row.root, combined);
        }

        return roles;
    }

    // Every direct grant this user holds on the given nodes -- one flat lookup over share_grantee_user_id_idx, no walk.
    // A children listing composes these with the parent's already-resolved role instead of re-walking each child's
    // chain: a child's chain is the child plus the parent's chain, and the parent's chain is already folded into the
    // parent's role, so max(parentRole, ownership(child), directGrant(child)) is the full resolution.
    async directGrants(userID : string, nodeIDs : readonly string[]) : Promise<Map<string, ShareRole>>
    {
        const grants = new Map<string, ShareRole>();
        if(nodeIDs.length === 0) { return grants; }

        const rows = await this.#db
            .selectFrom('share')
            .select([ 'node_id', 'role' ])
            .where('grantee_user_id', '=', userID)
            .where('node_id', 'in', nodeIDs)
            .execute();

        for(const row of rows) { grants.set(row.node_id, row.role); }

        return grants;
    }

    // Every distinct user holding a grant on ANY of the given nodes -- pass a node plus its ancestor chain and this
    // answers "who can currently see this node through a share". One flat lookup, no walk; the caller supplies the
    // chain (NodeRA.ancestorIDs) precisely because grants on ancestors reach everything beneath them.
    async granteeIDsFor(nodeIDs : readonly string[]) : Promise<string[]>
    {
        if(nodeIDs.length === 0) { return []; }

        const rows = await this.#db
            .selectFrom('share')
            .select('grantee_user_id')
            .distinct()
            .where('node_id', 'in', nodeIDs)
            .execute();

        return rows.map((row) => row.grantee_user_id);
    }

    // How many people hold a grant on each of the given nodes, keyed by node id -- a whole listing page in one query.
    // DIRECT grants only, matching what the node's own share dialog lists: a grant on an ancestor is that ancestor's
    // exposure, reported on the ancestor's own row. A node nobody holds a grant on is absent from the map.
    async granteeCountsByNode(nodeIDs : readonly string[]) : Promise<Map<string, number>>
    {
        const counts = new Map<string, number>();
        if(nodeIDs.length === 0) { return counts; }

        const rows = await this.#db
            .selectFrom('share')
            .select((eb) => [ 'node_id', eb.fn.countAll().as('count') ])
            .where('node_id', 'in', nodeIDs)
            .groupBy('node_id')
            .execute();

        for(const row of rows) { counts.set(row.node_id, Number(row.count)); }

        return counts;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Share rows
    //------------------------------------------------------------------------------------------------------------------

    // Create the grant, or -- if this grantee already holds one on the node -- update its role in place, returning
    // whichever row now stands. ONE statement, so two concurrent grants to the same grantee cannot both read "no
    // existing grant" and then both insert, tripping the UNIQUE (node_id, grantee_user_id) constraint; the loser
    // updates instead. A re-grant keeps the existing row's id and provenance, so the caller's `share.id` is stable
    // across a role change. The `share` argument's id is used only when the insert actually lands.
    async upsertShare(share : Share) : Promise<Share>
    {
        const row = await this.#db
            .insertInto('share')
            .values(rowFromShare(share))
            .onConflict((oc) => oc
                .columns([ 'node_id', 'grantee_user_id' ])
                .doUpdateSet({ role: share.role }))
            .returningAll()
            .executeTakeFirstOrThrow();

        return shareFromRow(row);
    }

    async getShareById(id : string) : Promise<Share | undefined>
    {
        const row = await this.#db
            .selectFrom('share')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        return row === undefined ? undefined : shareFromRow(row);
    }

    async getShareByNodeGrantee(nodeID : string, granteeID : string) : Promise<Share | undefined>
    {
        const row = await this.#db
            .selectFrom('share')
            .selectAll()
            .where('node_id', '=', nodeID)
            .where('grantee_user_id', '=', granteeID)
            .executeTakeFirst();

        return row === undefined ? undefined : shareFromRow(row);
    }

    async deleteShare(id : string) : Promise<boolean>
    {
        const result = await this.#db
            .deleteFrom('share')
            .where('id', '=', id)
            .executeTakeFirst();

        return Number(result?.numDeletedRows ?? 0) > 0;
    }

    // Every grant on a node, for the owner's share list. Ordered by created_at -- cuid2 ids are non-monotonic, so id
    // is never a stand-in for insertion order.
    async listByNode(nodeID : string) : Promise<Share[]>
    {
        const rows = await this.#db
            .selectFrom('share')
            .selectAll()
            .where('node_id', '=', nodeID)
            .orderBy('created_at', 'asc')
            .execute();

        return rows.map(shareFromRow);
    }

    // The caller's active shares, each joined to its (non-trashed) target for a display summary and probed for a
    // placement (a link the caller owns pointing at the shared node). A trashed target is excluded -- the owner
    // trashing a shared item hides it from recipients.
    async sharedWithMe(granteeID : string) : Promise<SharedWithMeRow[]>
    {
        const rows = await this.#db
            .selectFrom('share')
            .innerJoin('node', 'node.id', 'share.node_id')
            .where('share.grantee_user_id', '=', granteeID)
            .where('node.trashed_at', 'is', null)
            .select((eb) => [
                'share.id as id',
                'share.node_id as node_id',
                'share.grantee_user_id as grantee_user_id',
                'share.role as role',
                'share.created_by as created_by',
                'share.created_at as created_at',
                'node.type as target_type',
                'node.name as target_name',
                'node.owner_id as target_owner_id',
                'node.mime_type as target_mime_type',
                'node.size as target_size',
                'node.updated_at as target_updated_at',
                eb.exists(eb
                    .selectFrom('node as link')
                    .select('link.id')
                    .whereRef('link.target_node_id', '=', 'share.node_id')
                    .where('link.owner_id', '=', granteeID)
                    .where('link.type', '=', 'link')).as('placed'),
            ])
            .orderBy('share.created_at', 'asc')
            .execute();

        return rows.map((row) => ({
            share: {
                id: row.id,
                nodeID: row.node_id,
                granteeUserID: row.grantee_user_id,
                role: row.role,
                createdBy: row.created_by,
                createdAt: new Date(row.created_at),
            },
            target: {
                id: row.node_id,
                type: row.target_type,
                name: row.target_name,
                ownerID: row.target_owner_id,
                mimeType: row.target_mime_type ?? undefined,
                size: row.target_size ?? undefined,
            },
            updatedAt: new Date(row.target_updated_at),
            placed: toBool(row.placed),
        }));
    }

    //------------------------------------------------------------------------------------------------------------------
    // Share request rows
    //------------------------------------------------------------------------------------------------------------------

    async insertRequest(request : PendingShareRequest) : Promise<void>
    {
        await this.#db
            .insertInto('share_request')
            .values(rowFromPendingShareRequest(request))
            .execute();
    }

    async getRequestById(id : string) : Promise<ShareRequest | undefined>
    {
        const row = await this.#db
            .selectFrom('share_request')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        return row === undefined ? undefined : shareRequestFromRow(row);
    }

    // Resolve a request: move it off 'pending' and stamp resolved_at together, satisfying the paired CHECK.
    async resolveRequest(id : string, status : ResolvedShareRequestStatus, resolvedAt : Date) : Promise<void>
    {
        await this.#db
            .updateTable('share_request')
            .set({ status, resolved_at: resolvedAt.toISOString() })
            .where('id', '=', id)
            .execute();
    }

    // Requests pending for an owner: routed to the TARGET's owner, so the join is through node.owner_id, never the
    // folder sharer who has no granting authority in v1.
    async listPendingByOwner(ownerID : string) : Promise<ShareRequest[]>
    {
        const rows = await this.#db
            .selectFrom('share_request')
            .innerJoin('node', 'node.id', 'share_request.node_id')
            .where('node.owner_id', '=', ownerID)
            .where('share_request.status', '=', 'pending')
            .selectAll('share_request')
            .orderBy('share_request.created_at', 'asc')
            .execute();

        return rows.map(shareRequestFromRow);
    }

    async listByRequester(requesterID : string) : Promise<ShareRequest[]>
    {
        const rows = await this.#db
            .selectFrom('share_request')
            .selectAll()
            .where('requester_id', '=', requesterID)
            .orderBy('created_at', 'asc')
            .execute();

        return rows.map(shareRequestFromRow);
    }

    // How many access requests are waiting on someone instance-wide -- the admin overview's queue depth, not scoped
    // to any one owner.
    async pendingRequestCount() : Promise<number>
    {
        const row = await this.#db
            .selectFrom('share_request')
            .select((eb) => eb.fn.countAll().as('count'))
            .where('status', '=', 'pending')
            .executeTakeFirstOrThrow();

        return Number(row.count);
    }

    // The caller's outstanding request on a node, if any -- the manager's guard against a duplicate pending request per
    // (node, requester) (the partial-unique constraint was deferred, so this is manager-enforced).
    async findPendingByNodeRequester(nodeID : string, requesterID : string) : Promise<ShareRequest | undefined>
    {
        const row = await this.#db
            .selectFrom('share_request')
            .selectAll()
            .where('node_id', '=', nodeID)
            .where('requester_id', '=', requesterID)
            .where('status', '=', 'pending')
            .executeTakeFirst();

        return row === undefined ? undefined : shareRequestFromRow(row);
    }
}

//----------------------------------------------------------------------------------------------------------------------
