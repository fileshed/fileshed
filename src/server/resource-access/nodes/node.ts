//----------------------------------------------------------------------------------------------------------------------
// Node Resource Access
//
// The query surface over the `node` table that the node/share managers build on: reads (get, getMany, children), the
// structural walks (ancestorIDs, the subtree trash update), plain writes (insert, rename, move, hardDelete), and the
// derived aggregate quotas lean on (ownedBytes). Rows cross the row<->domain boundary in transforms.ts; nothing here
// models a node itself.
//
// Two recursive CTEs carry the tree logic, written once in Kysely so both dialects get the same walk (requirements.md
// secs 3.2/4.4): ancestorIDs climbs parent edges to the root, and setTrashed descends the subtree. Both follow
// parent_id only -- never target_node_id -- so links, which are inert pointers (sec 3.2b), never steer a traversal.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- update sets and CTE column lists name snake_case DB columns (house convention) */

import { sql } from 'kysely';

// Models
import type { Node } from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';
import { nodeFromRow, rowFromNode } from './transforms.ts';

//----------------------------------------------------------------------------------------------------------------------

export type NodeSortKey = 'name' | 'size' | 'createdAt' | 'updatedAt';
export type SortDirection = 'asc' | 'desc';

export interface NodeSort
{
    key : NodeSortKey;
    direction : SortDirection;
}

export interface Pagination
{
    limit : number;
    offset : number;
}

// A location in a user's tree: the folder to list under (null = their root) and whose owned nodes to list.
export interface ChildrenQuery
{
    parentID : string | null;
    ownerID : string;
}

export interface ChildrenOptions
{
    pagination : Pagination;
    sort : NodeSort;
}

// Whitelists the sortable columns (requirements.md sec 7) so a caller's sort key can never reach orderBy as raw SQL.
const sortColumns : Record<NodeSortKey, 'name' | 'size' | 'created_at' | 'updated_at'> = {
    name: 'name',
    size: 'size',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
};

//----------------------------------------------------------------------------------------------------------------------

export class NodeRA
{
    readonly #db : DatabaseHandle['db'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Reads
    //------------------------------------------------------------------------------------------------------------------

    async get(id : string) : Promise<Node | undefined>
    {
        const row = await this.#db
            .selectFrom('node')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        return row === undefined ? undefined : nodeFromRow(row);
    }

    // Bulk lookup for link-target resolution: a page of links resolves its targets in one round trip.
    async getMany(ids : readonly string[]) : Promise<Node[]>
    {
        if(ids.length === 0) { return []; }

        const rows = await this.#db
            .selectFrom('node')
            .selectAll()
            .where('id', 'in', ids)
            .execute();

        return rows.map(nodeFromRow);
    }

    // The owner's own nodes directly under `parentID` (their links included as-is; resolving targets is the manager's
    // job via getMany), excluding trashed items from the normal listing (requirements.md secs 4.4/7). Cross-owner
    // contributions in a shared folder (sec 3.3) belong to another owner and are composed in by the manager, not here.
    // The id tiebreaker only makes pagination deterministic when the sort key ties -- ordering semantics stay the sort
    // key's (cuid2 ids are non-monotonic and never stand in for insertion order, sec 3).
    async children(query : ChildrenQuery, options : ChildrenOptions) : Promise<Node[]>
    {
        const { pagination, sort } = options;

        let builder = this.#db
            .selectFrom('node')
            .selectAll()
            .where('owner_id', '=', query.ownerID)
            .where('trashed_at', 'is', null);

        builder = query.parentID === null
            ? builder.where('parent_id', 'is', null)
            : builder.where('parent_id', '=', query.parentID);

        const rows = await builder
            .orderBy(sortColumns[sort.key], sort.direction)
            .orderBy('id', 'asc')
            .limit(pagination.limit)
            .offset(pagination.offset)
            .execute();

        return rows.map(nodeFromRow);
    }

    // The unpaginated child count for the same location `children` lists -- the grand total a page envelope reports so
    // a client can size its pagination. Uses the identical owner/parent/trashed filter as `children` so the count and
    // the page can never describe different sets.
    async countChildren(query : ChildrenQuery) : Promise<number>
    {
        let builder = this.#db
            .selectFrom('node')
            .select((eb) => eb.fn.count('id').as('count'))
            .where('owner_id', '=', query.ownerID)
            .where('trashed_at', 'is', null);

        builder = query.parentID === null
            ? builder.where('parent_id', 'is', null)
            : builder.where('parent_id', '=', query.parentID);

        const row = await builder.executeTakeFirstOrThrow();

        return Number(row.count);
    }

    // The ancestor chain of `id` by parent edges, nearest parent first up to the root, excluding `id` itself -- the
    // shape the move-cycle judge expects for parentAncestorIDs, and the walk permission resolution will reuse
    // (requirements.md secs 3.2/3.4). The recursion follows parent_id only, so a link never joins the chain.
    async ancestorIDs(id : string) : Promise<string[]>
    {
        const rows = await this.#db
            .withRecursive('chain(id, parent_id, depth)', (qc) => qc
                .selectFrom('node')
                .select([ 'id', 'parent_id', sql<number>`0`.as('depth') ])
                .where('id', '=', id)
                .unionAll(qc
                    .selectFrom('node as parent')
                    .innerJoin('chain', 'chain.parent_id', 'parent.id')
                    .select([ 'parent.id', 'parent.parent_id', sql<number>`chain.depth + 1`.as('depth') ])))
            .selectFrom('chain')
            .select(sql<string>`id`.as('id'))
            .where('depth', '>', 0)
            .orderBy('depth', 'asc')
            .execute();

        return rows.map((row) => row.id);
    }

    // The distinct blob shas of every file node in the subtree rooted at `id` (including `id` itself), gathered by
    // descending parent edges -- the set a hard delete might orphan, collected BEFORE the delete removes the rows
    // (requirements.md secs 4.2/4.4). The walk follows parent_id only, so links never steer it; links carry no blob and
    // are ignored by the `type = 'file'` guard.
    async subtreeFileBlobIDs(id : string) : Promise<string[]>
    {
        const rows = await this.#db
            .withRecursive('subtree(id)', (qc) => qc
                .selectFrom('node')
                .select('id')
                .where('id', '=', id)
                .unionAll(qc
                    .selectFrom('node as child')
                    .innerJoin('subtree', 'subtree.id', 'child.parent_id')
                    .select('child.id')))
            .selectFrom('node')
            .select('blob_id')
            .where('type', '=', 'file')
            .where('blob_id', 'is not', null)
            .where('id', 'in', (eb) => eb.selectFrom('subtree').select('id'))
            .execute();

        const shas = new Set<string>();
        for(const row of rows)
        {
            if(row.blob_id !== null) { shas.add(row.blob_id); }
        }

        return [ ...shas ];
    }

    //------------------------------------------------------------------------------------------------------------------
    // Writes
    //------------------------------------------------------------------------------------------------------------------

    async insert(node : Node) : Promise<void>
    {
        await this.#db
            .insertInto('node')
            .values(rowFromNode(node))
            .execute();
    }

    async rename(id : string, name : string) : Promise<void>
    {
        await this.#db
            .updateTable('node')
            .set({ name, updated_at: new Date().toISOString() })
            .where('id', '=', id)
            .execute();
    }

    async move(id : string, newParentID : string | null) : Promise<void>
    {
        await this.#db
            .updateTable('node')
            .set({ parent_id: newParentID, updated_at: new Date().toISOString() })
            .where('id', '=', id)
            .execute();
    }

    // Trash (a Date) or restore (null) the whole subtree rooted at `id` as a unit, so a folder and everything under it
    // hide and reappear together (requirements.md sec 4.4). The subtree is gathered by descending parent edges in a
    // recursive CTE; links are skipped by the `type <> 'link'` guard because a link may never carry trashed_at (the
    // variant CHECK, sec 3.2b) -- a link inside a trashed folder is hidden transitively by its trashed ancestor, its
    // own row untouched.
    async setTrashed(id : string, trashedAt : Date | null) : Promise<void>
    {
        const value = trashedAt === null ? null : trashedAt.toISOString();

        await this.#db
            .withRecursive('subtree(id)', (qc) => qc
                .selectFrom('node')
                .select('id')
                .where('id', '=', id)
                .unionAll(qc
                    .selectFrom('node as child')
                    .innerJoin('subtree', 'subtree.id', 'child.parent_id')
                    .select('child.id')))
            .updateTable('node')
            .set({ trashed_at: value })
            .where('id', 'in', (eb) => eb.selectFrom('subtree').select('id'))
            .where('type', '<>', 'link')
            .execute();
    }

    // Permanent delete. The parent_id and target_node_id cascades do the rest of the work: the subtree goes with the
    // folder, and every link pointing at a deleted node dies with it across all trees (requirements.md secs 3.2b/4.4).
    // Accepts an executor so the manager can run this and the blob-graveyard handoff in one transaction -- a crash
    // between them would otherwise strand the subtree's now-unreferenced blobs (row gone, no graveyard marker, GC blind
    // to them). Defaults to the handle's connection for callers that need no transaction.
    async hardDelete(id : string, executor : DatabaseHandle['db'] = this.#db) : Promise<void>
    {
        await executor
            .deleteFrom('node')
            .where('id', '=', id)
            .execute();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Derived aggregates
    //------------------------------------------------------------------------------------------------------------------

    // The quota charge for a user: the total logical size of the file nodes they own, trashed included and folders and
    // links (which have no size) excluded (requirements.md sec 5). Runs on every upload admission -- one aggregate over
    // node_owner_id_idx. Postgres sum(bigint) comes back as a numeric string and SQLite as a number; Number spans both.
    async ownedBytes(ownerID : string) : Promise<number>
    {
        const row = await this.#db
            .selectFrom('node')
            .select(sql<string | number>`coalesce(sum(size), 0)`.as('total'))
            .where('owner_id', '=', ownerID)
            .where('type', '=', 'file')
            .executeTakeFirstOrThrow();

        return Number(row.total);
    }
}

//----------------------------------------------------------------------------------------------------------------------
