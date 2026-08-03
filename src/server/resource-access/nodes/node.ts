//----------------------------------------------------------------------------------------------------------------------
// Node Resource Access
//
// The query surface over the `node` table that the node/share managers build on: reads (get, getMany, children), the
// structural walks (ancestorIDs, ancestorChains, the subtree trash update), plain writes (insert, rename, move,
// hardDelete), and the derived aggregate quotas lean on (ownedBytes). Rows cross the row<->domain boundary in
// transforms.ts; nothing here models a node itself.
//
// Three recursive CTEs carry the tree logic, written once in Kysely so both dialects get the same walk: ancestorIDs
// climbs parent edges to the root, ancestorChains climbs them for many nodes at once, and setTrashed descends the
// subtree. All follow parent_id only -- never target_node_id -- so links, which are inert pointers, never steer a
// traversal.
//----------------------------------------------------------------------------------------------------------------------

/* eslint-disable camelcase -- update sets and CTE column lists name snake_case DB columns (house convention) */

import { type Expression, type ExpressionBuilder, type SqlBool, sql } from 'kysely';

// Models
import {
    type LinkNode,
    MAX_TREE_DEPTH,
    MIME_FAMILY_SPECS,
    type Node,
    type NodeTypeFamily,
    PLAYLIST_EXTENSIONS,
    PLAYLIST_MIME_LIST,
    type UserSummary,
} from '@fileshed/core';

// Resource Access
import type { Database, DatabaseHandle } from '../database/database.ts';
import { nodeFromRow, rowFromNode } from './transforms.ts';

// Utils
import { avatarImage } from '../../utils/avatarImage.ts';
import { escapeLikePattern } from '../../utils/likePattern.ts';

//----------------------------------------------------------------------------------------------------------------------

export type NodeSortKey = 'name' | 'size' | 'createdAt' | 'updatedAt' | 'kind';
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

// One rung of an ancestor walk: enough to name the folder and to judge where the chain roots, without dragging a whole
// node across for a breadcrumb that only ever renders a label.
export interface Ancestor
{
    id : string;
    name : string;
    ownerID : string;
    parentID : string | null;
}

// The listing filters, AND-combined. An empty `types` is unfiltered; a single-select owner, an exact-name match, and
// a half-open date window (updatedAfter inclusive, updatedBefore exclusive) are absent when their filter is off.
// Distinct from the listing's location: `ownerID` here narrows a folder to one contributor, where a location's ownerID
// only scopes the root. `name` is an exact equality (upload collision detection), not the substring searchByName runs.
export interface NodeFilters
{
    types : readonly NodeTypeFamily[];
    ownerID ?: string;
    name ?: string;
    updatedAfter ?: Date;
    updatedBefore ?: Date;
}

// Whitelists the sortable columns so a caller's sort key can never reach orderBy as raw SQL. A key maps to the ordered
// columns its partition sorts by: 'kind' widens to (type, mime type, name) so the file/link partition groups by type
// and then by format; every other key is a single column. Folders are pinned above this ordering separately.
type SortColumn = 'name' | 'size' | 'created_at' | 'updated_at' | 'type' | 'mime_type';

// Several of these are nullable -- size on links, mime_type on anything that is not a file -- and the two dialects
// disagree about where an absent value belongs: Postgres sorts nulls high, SQLite sorts them low. Every listing that
// orders by one of these states the placement explicitly, in Postgres's terms, so a page does not depend on which
// database is underneath it.
const sortColumns : Record<NodeSortKey, readonly SortColumn[]> = {
    name: [ 'name' ],
    size: [ 'size' ],
    createdAt: [ 'created_at' ],
    updatedAt: [ 'updated_at' ],
    kind: [ 'type', 'mime_type', 'name' ],
};

// The folded form every name-ordered listing sorts by, so `apple` sits beside `Apple` instead of behind a run of
// capitals. It also settles a dialect split: raw text orders by byte on SQLite and by locale on Postgres, and only one
// of those puts `Zebra` after `apple`. An index over the same expression is what keeps the folded ordering cheap.
function lowerName(column : 'name' | 'node.name') : Expression<string>
{
    return sql<string>`lower(${ sql.ref(column) })`;
}

// Name is the one sort column that orders on a derived value rather than what is stored; every other column sorts as
// it sits.
function sortTarget(column : SortColumn) : SortColumn | Expression<string>
{
    return column === 'name' ? lowerName('name') : column;
}

type NodeExpressionBuilder = ExpressionBuilder<Database, 'node'>;

// Membership in the playlists family goes beyond mime: browsers and servers disagree on m3u mimes often enough
// that uploads arrive with empty or generic types, so the file EXTENSION is the more reliable witness -- the same
// verdict isPlaylistFile renders client-side. The extension patterns are literal constants, so no LIKE escaping.
function playlistCondition(eb : NodeExpressionBuilder) : Expression<SqlBool>
{
    return eb.or([
        eb(sql<string>`lower(mime_type)`, 'in', [ ...PLAYLIST_MIME_LIST ]),
        ...PLAYLIST_EXTENSIONS.map((extension) => sql<SqlBool>`lower(name) like ${ `%${ extension }` }`),
    ]);
}

// The WHERE fragment one type-family selects. 'folders' and 'links' select by node type outright; every other family
// selects file nodes and narrows by mime, built from the same MIME_FAMILY_SPECS the client classifies with -- a LIKE
// prefix per prefix spec (text/%, image/%) OR-ed with an IN over the exact mimes. The mime patterns are literal (no
// user input), so no LIKE escaping is needed. Playlists and audio are the one entangled pair: playlist mimes match
// the audio/ prefix, so audio explicitly excludes what playlists claims -- filtering by Audio must not surface the
// playlists the user asked us to make distinguishable.
function familyCondition(eb : NodeExpressionBuilder, family : NodeTypeFamily) : Expression<SqlBool>
{
    if(family === 'folders') { return eb('type', '=', 'folder'); }
    if(family === 'links') { return eb('type', '=', 'link'); }
    if(family === 'playlists') { return eb.and([ eb('type', '=', 'file'), playlistCondition(eb) ]); }

    const spec = MIME_FAMILY_SPECS[family];

    // Lowercased because a media type is case-insensitive and nothing upstream normalizes one an API client supplied.
    // It also settles a dialect split: Postgres LIKE is case-sensitive where SQLite's is not, so an uppercased mime
    // would otherwise be filed under its family on one deployment and nowhere at all on the other.
    const mime = sql<string>`lower(mime_type)`;

    const mimeTerms : Expression<SqlBool>[] = spec.prefixes.map((prefix) => eb(mime, 'like', `${ prefix }%`));
    if(spec.exact.length > 0) { mimeTerms.push(eb(mime, 'in', [ ...spec.exact ])); }

    const conditions = [ eb('type', '=', 'file'), eb.or(mimeTerms) ];
    if(family === 'audio') { conditions.push(eb.not(playlistCondition(eb))); }

    return eb.and(conditions);
}

function hasFilters(filters : NodeFilters) : boolean
{
    return filters.types.length > 0
        || filters.ownerID !== undefined
        || filters.name !== undefined
        || filters.updatedAfter !== undefined
        || filters.updatedBefore !== undefined;
}

// The AND of every active filter. Selected families OR together into one term; owner and the date bounds add their own.
// updated_at is stored as an ISO string (SQLite) or a timestamp (Postgres) and both compare correctly against an ISO
// bound, the same crossing expiredTrashRootIDs relies on.
function filterConditions(eb : NodeExpressionBuilder, filters : NodeFilters) : Expression<SqlBool>[]
{
    const conditions : Expression<SqlBool>[] = [];

    if(filters.types.length > 0)
    {
        conditions.push(eb.or(filters.types.map((family) => familyCondition(eb, family))));
    }
    if(filters.ownerID !== undefined) { conditions.push(eb('owner_id', '=', filters.ownerID)); }
    if(filters.name !== undefined) { conditions.push(eb('name', '=', filters.name)); }
    if(filters.updatedAfter !== undefined)
    {
        conditions.push(eb('updated_at', '>=', filters.updatedAfter.toISOString()));
    }
    if(filters.updatedBefore !== undefined)
    {
        conditions.push(eb('updated_at', '<', filters.updatedBefore.toISOString()));
    }

    return conditions;
}

// The predicate isolating one owner's trashed subtree ROOTS: a trashed node they own whose parent is not itself
// trashed (or which sits at root level). setTrashed stamps a whole subtree, so a trashed folder's descendants each
// carry a trashed_at too; the NOT EXISTS drops any node whose parent is trashed, leaving only the top of each trashed
// subtree -- the same root definition expiredTrashRootIDs uses, so a nested trashed child never double-lists.
function trashedRootConditions(eb : NodeExpressionBuilder, ownerID : string) : Expression<SqlBool>[]
{
    return [
        eb('owner_id', '=', ownerID),
        eb('trashed_at', 'is not', null),
        eb.not(eb.exists(
            eb.selectFrom('node as ancestor')
                .select(sql`1`.as('present'))
                .whereRef('ancestor.id', '=', 'node.parent_id')
                .where('ancestor.trashed_at', 'is not', null)
        )),
    ];
}

//----------------------------------------------------------------------------------------------------------------------

export class NodeRA
{
    readonly #db : DatabaseHandle['db'];
    readonly #kind : DatabaseHandle['kind'];

    constructor(handle : DatabaseHandle)
    {
        this.#db = handle.db;
        this.#kind = handle.kind;
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

    // The nodes directly under `parentID` (links included as-is; resolving targets is the manager's job via getMany),
    // excluding trashed items from the normal listing. A folder's listing is scoped by the folder alone: contributions
    // belong to another owner but travel with the folder, so owner_id only filters the ROOT listing (parentID null),
    // where per-user trees begin. Authorization is the manager's job before this query runs.
    //
    // Folders always sort above non-folders (files and links share the lower partition), whatever the sort key or its
    // direction -- a fixed leading criterion the direction never flips. This lives in the query, not the client,
    // because the partition has to hold across page boundaries a paginated client cannot re-partition. Within each
    // partition the sort key applies, then the id tiebreaker makes pagination deterministic when the key ties (cuid2
    // ids are non-monotonic and never stand in for insertion order).
    async children(query : ChildrenQuery, options : ChildrenOptions, filters ?: NodeFilters) : Promise<Node[]>
    {
        const { pagination, sort } = options;

        let builder = this.#db
            .selectFrom('node')
            .selectAll()
            .where('trashed_at', 'is', null);

        builder = query.parentID === null
            ? builder.where('parent_id', 'is', null).where('owner_id', '=', query.ownerID)
            : builder.where('parent_id', '=', query.parentID);

        if(filters !== undefined && hasFilters(filters))
        {
            builder = builder.where((eb) => eb.and(filterConditions(eb, filters)));
        }

        // 0 for a folder, 1 for anything else: a plain integer key that sorts folders first on both dialects. CASE is
        // portable, and sql.ref quotes the `type` column so the SQL keyword can never be read as bare identifier.
        builder = builder.orderBy(sql<number>`case when ${ sql.ref('type') } = 'folder' then 0 else 1 end`, 'asc');

        for(const column of sortColumns[sort.key])
        {
            builder = builder.orderBy(sortTarget(column), (ob) =>
            {
                return sort.direction === 'asc' ? ob.asc().nullsLast() : ob.desc().nullsFirst();
            });
        }

        const rows = await builder
            .orderBy('id', 'asc')
            .limit(pagination.limit)
            .offset(pagination.offset)
            .execute();

        return rows.map(nodeFromRow);
    }

    // The unpaginated child count for the same location `children` lists -- the grand total a page envelope reports so
    // a client can size its pagination. Applies the identical location AND filters as `children` so the count and the
    // page can never describe different sets: a filtered total reflects the filtered listing.
    async countChildren(query : ChildrenQuery, filters ?: NodeFilters) : Promise<number>
    {
        let builder = this.#db
            .selectFrom('node')
            .select((eb) => eb.fn.count('id').as('count'))
            .where('trashed_at', 'is', null);

        builder = query.parentID === null
            ? builder.where('parent_id', 'is', null).where('owner_id', '=', query.ownerID)
            : builder.where('parent_id', '=', query.parentID);

        if(filters !== undefined && hasFilters(filters))
        {
            builder = builder.where((eb) => eb.and(filterConditions(eb, filters)));
        }

        const row = await builder.executeTakeFirstOrThrow();

        return Number(row.count);
    }

    // The distinct owners of the nodes at a listing's location -- the whole (non-trashed) folder, NOT a page, and
    // deliberately unfiltered by the type/owner/date filters so the owner-filter menu still lists every owner while an
    // owner filter is active (otherwise a filter down to one owner would erase the way back). Joins user for the
    // display summary; ordered by name for a stable menu.
    async ownersOf(query : ChildrenQuery) : Promise<UserSummary[]>
    {
        let builder = this.#db
            .selectFrom('node')
            .innerJoin('user', 'user.id', 'node.owner_id')
            .select([
                'user.id as id',
                'user.name as name',
                'user.email as email',
                'user.avatar_sha256 as avatarSha256',
            ])
            .distinct()
            .where('node.trashed_at', 'is', null);

        builder = query.parentID === null
            ? builder.where('node.parent_id', 'is', null).where('node.owner_id', '=', query.ownerID)
            : builder.where('node.parent_id', '=', query.parentID);

        const rows = await builder.orderBy('user.name', 'asc').execute();

        return rows.map((row) => ({
            id: row.id,
            name: row.name,
            email: row.email,
            image: avatarImage(row.avatarSha256),
        }));
    }

    // The ancestor chain of `id` by parent edges, nearest parent first up to the root, excluding `id` itself -- the
    // shape the move-cycle judge expects for parentAncestorIDs, and the walk permission resolution will reuse.
    // The recursion follows parent_id only, so a link never joins the chain.
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
                    .select([ 'parent.id', 'parent.parent_id', sql<number>`chain.depth + 1`.as('depth') ])
                    .where('chain.depth', '<', MAX_TREE_DEPTH)))
            .selectFrom('chain')
            .select(sql<string>`id`.as('id'))
            .where('depth', '>', 0)
            .orderBy('depth', 'asc')
            .execute();

        return rows.map((row) => row.id);
    }

    // The ancestor chains of many nodes at once, each keyed by the node it belongs to and ordered nearest parent
    // first, excluding the node itself. Every requested id seeds its own chain in ONE recursive CTE -- a search page
    // resolves its whole set of locations without fanning out a query per hit. A requested id that names no row simply
    // maps to nothing; the caller reads an absent chain as empty.
    async ancestorChains(ids : readonly string[]) : Promise<Map<string, Ancestor[]>>
    {
        const chains = new Map<string, Ancestor[]>();
        if(ids.length === 0) { return chains; }

        const rows = await this.#db
            .withRecursive('chains(root, id, name, owner_id, parent_id, depth)', (qc) => qc
                .selectFrom('node')
                .select([
                    sql<string>`id`.as('root'),
                    'id',
                    'name',
                    'owner_id',
                    'parent_id',
                    sql<number>`0`.as('depth'),
                ])
                .where('id', 'in', ids)
                .unionAll(qc
                    .selectFrom('node as ancestor')
                    .innerJoin('chains', 'chains.parent_id', 'ancestor.id')
                    .where('chains.depth', '<', MAX_TREE_DEPTH)
                    .select([
                        'chains.root',
                        'ancestor.id',
                        'ancestor.name',
                        'ancestor.owner_id',
                        'ancestor.parent_id',
                        sql<number>`chains.depth + 1`.as('depth'),
                    ])))
            .selectFrom('chains')
            .select([
                sql<string>`root`.as('root'),
                sql<string>`id`.as('id'),
                sql<string>`name`.as('name'),
                sql<string>`owner_id`.as('owner_id'),
                sql<string | null>`parent_id`.as('parent_id'),
                sql<number>`depth`.as('depth'),
            ])
            .where('depth', '>', 0)
            .orderBy('depth', 'asc')
            .execute();

        for(const row of rows)
        {
            const chain = chains.get(row.root) ?? [];
            chain.push({ id: row.id, name: row.name, ownerID: row.owner_id, parentID: row.parent_id });
            chains.set(row.root, chain);
        }

        return chains;
    }

    // The distinct blob shas of every file node in the subtree rooted at `id` (including `id` itself), gathered by
    // descending parent edges -- the set a hard delete might orphan, collected BEFORE the delete removes the rows. The
    // walk follows parent_id only, so links never steer it; links carry no blob and are ignored by the `type = 'file'`
    // guard.
    async subtreeFileBlobIDs(id : string) : Promise<string[]>
    {
        const rows = await this.#db
            .withRecursive('subtree(id, depth)', (qc) => qc
                .selectFrom('node')
                .select([ 'id', sql<number>`0`.as('depth') ])
                .where('id', '=', id)
                .unionAll(qc
                    .selectFrom('node as child')
                    .innerJoin('subtree', 'subtree.id', 'child.parent_id')
                    .select([ 'child.id', sql<number>`subtree.depth + 1`.as('depth') ])
                    .where('subtree.depth', '<', MAX_TREE_DEPTH)))
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

    // The link children directly under `parentID` that `ownerID` placed -- the candidate set a broken-link purge
    // resolves and prunes. Scoped to the caller's own links because a purge removes only their placements, never a
    // contributor's links in a shared folder; scoped to direct children because "clean up broken links" acts on the
    // folder the caller is looking at, not its whole subtree.
    async linkChildrenOwnedBy(parentID : string, ownerID : string) : Promise<LinkNode[]>
    {
        const rows = await this.#db
            .selectFrom('node')
            .selectAll()
            .where('parent_id', '=', parentID)
            .where('owner_id', '=', ownerID)
            .where('type', '=', 'link')
            .execute();

        return rows.map(nodeFromRow).filter((node) : node is LinkNode => node.type === 'link');
    }

    // A case-insensitive substring match on node name OR the content's embedded tags (title/artist/album, when
    // extraction has run for the blob), capped at `limit`, excluding trashed nodes. The match is dialect-aware:
    // Postgres LIKE is case-sensitive so it needs ILIKE, while SQLite LIKE is already case-insensitive for ASCII;
    // both take an explicit ESCAPE so the pattern's escaped metacharacters behave identically. This is a
    // match superset -- the caller resolves and filters these to the nodes it may actually see.
    async searchByName(term : string, limit : number) : Promise<Node[]>
    {
        const pattern = `%${ escapeLikePattern(term) }%`;
        const matches = (column : string) : Expression<SqlBool> =>
        {
            const ref = sql.ref(column);
            return this.#kind === 'postgres'
                ? sql<SqlBool>`${ ref } ilike ${ pattern } escape '\\'`
                : sql<SqlBool>`${ ref } like ${ pattern } escape '\\'`;
        };

        const rows = await this.#db
            .selectFrom('node')
            .leftJoin('media_tags', 'media_tags.blob_id', 'node.blob_id')
            .selectAll('node')
            .where('node.trashed_at', 'is', null)
            .where((eb) => eb.or([
                matches('node.name'),
                matches('media_tags.title'),
                matches('media_tags.artist'),
                matches('media_tags.album'),
            ]))
            .orderBy(lowerName('node.name'), 'asc')
            .orderBy('node.id', 'asc')
            .limit(limit)
            .execute();

        return rows.map(nodeFromRow);
    }

    // The ids of trashed subtree ROOTS whose grace window has lapsed -- the set the auto-purge sweep permanently
    // deletes. A root is a trashed node whose parent is NOT itself trashed (or which sits at root level). setTrashed
    // stamps a whole subtree in one shot, so every node inside a trashed folder also carries a trashed_at; selecting
    // only the roots -- and letting the parent_id cascade take their descendants -- is what keeps the sweep from
    // trying to delete a child that its own root already removed. trashed_at is stored as an ISO string on both
    // dialects, so the cutoff is compared in its ISO form (a null trashed_at never satisfies `< cutoff`).
    async expiredTrashRootIDs(cutoff : Date) : Promise<string[]>
    {
        const rows = await this.#db
            .selectFrom('node as n')
            .leftJoin('node as parent', 'parent.id', 'n.parent_id')
            .select('n.id as id')
            .where('n.trashed_at', '<', cutoff.toISOString())
            .where((eb) => eb.or([
                eb('n.parent_id', 'is', null),
                eb('parent.trashed_at', 'is', null),
            ]))
            .execute();

        return rows.map((row) => row.id);
    }

    // The caller's Trash view: the ROOTS of their own trashed subtrees, one page at a time, paged and sorted exactly
    // as a folder listing is -- folders pinned above the file partition, the sort key within each, the id tiebreaker
    // for determinism. Owner-scoped, so only the caller's own trashed nodes appear; roots-only, so a trashed folder
    // lists once while everything inside it travels with it. Links never carry trashed_at, so none reach here.
    async trashedRoots(ownerID : string, options : ChildrenOptions, filters ?: NodeFilters) : Promise<Node[]>
    {
        const { pagination, sort } = options;

        let builder = this.#db
            .selectFrom('node')
            .selectAll()
            .where((eb) => eb.and(trashedRootConditions(eb, ownerID)));

        if(filters !== undefined && hasFilters(filters))
        {
            builder = builder.where((eb) => eb.and(filterConditions(eb, filters)));
        }

        builder = builder.orderBy(sql<number>`case when ${ sql.ref('type') } = 'folder' then 0 else 1 end`, 'asc');

        for(const column of sortColumns[sort.key])
        {
            builder = builder.orderBy(sortTarget(column), (ob) =>
            {
                return sort.direction === 'asc' ? ob.asc().nullsLast() : ob.desc().nullsFirst();
            });
        }

        const rows = await builder
            .orderBy('id', 'asc')
            .limit(pagination.limit)
            .offset(pagination.offset)
            .execute();

        return rows.map(nodeFromRow);
    }

    // The unpaginated count of the caller's trashed roots -- the grand total the trash-view envelope reports, over the
    // identical predicate `trashedRoots` pages, so the count and the page can never describe different sets.
    async countTrashedRoots(ownerID : string, filters ?: NodeFilters) : Promise<number>
    {
        let builder = this.#db
            .selectFrom('node')
            .select((eb) => eb.fn.count('id').as('count'))
            .where((eb) => eb.and(trashedRootConditions(eb, ownerID)));

        if(filters !== undefined && hasFilters(filters))
        {
            builder = builder.where((eb) => eb.and(filterConditions(eb, filters)));
        }

        const row = await builder.executeTakeFirstOrThrow();

        return Number(row.count);
    }

    // The unpaginated ids of every root of the caller's own trashed subtrees -- what "empty trash" purges whole, one
    // root at a time. Same owner-scoped root predicate `trashedRoots` pages against, bare ids instead of full pages,
    // the same shape `expiredTrashRootIDs` hands the auto-purge sweep.
    async trashedRootIDs(ownerID : string) : Promise<string[]>
    {
        const rows = await this.#db
            .selectFrom('node')
            .select('id')
            .where((eb) => eb.and(trashedRootConditions(eb, ownerID)))
            .execute();

        return rows.map((row) => row.id);
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

    // Repoint a file node at new content: its blob, logical size, and mime type, bumping updated_at. Name, parent, and
    // owner never change -- a replace overwrites bytes in place so the node keeps its id and every link and share
    // pointing at it stays valid. Runs inside the commit transaction alongside the blob write and the old-blob
    // graveyard sweep, so the reference move and the record write commit together.
    async replaceContent(id : string, blobID : string, size : number, mimeType : string, updatedAt : Date)
    : Promise<void>
    {
        await this.#db
            .updateTable('node')
            .set({ blob_id: blobID, size, mime_type: mimeType, updated_at: updatedAt.toISOString() })
            .where('id', '=', id)
            .execute();
    }

    // Trash (a Date) or restore (null) the whole subtree rooted at `id` as a unit, so a folder and everything under it
    // hide and reappear together. The subtree is gathered by descending parent edges in a recursive CTE; links are
    // skipped by the `type <> 'link'` guard because a link may never carry trashed_at (the variant CHECK) -- a link
    // inside a trashed folder is hidden transitively by its trashed ancestor, its own row untouched.
    async setTrashed(id : string, trashedAt : Date | null) : Promise<void>
    {
        const value = trashedAt === null ? null : trashedAt.toISOString();

        await this.#db
            .withRecursive('subtree(id, depth)', (qc) => qc
                .selectFrom('node')
                .select([ 'id', sql<number>`0`.as('depth') ])
                .where('id', '=', id)
                .unionAll(qc
                    .selectFrom('node as child')
                    .innerJoin('subtree', 'subtree.id', 'child.parent_id')
                    .select([ 'child.id', sql<number>`subtree.depth + 1`.as('depth') ])
                    .where('subtree.depth', '<', MAX_TREE_DEPTH)))
            .updateTable('node')
            .set({ trashed_at: value })
            .where('id', 'in', (eb) => eb.selectFrom('subtree').select('id'))
            .where('type', '<>', 'link')
            .execute();
    }

    // Permanent delete. The parent_id and target_node_id cascades do the rest of the work: the subtree goes with the
    // folder, and every link pointing at a deleted node dies with it across all trees.
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

    // Delete a set of nodes by id in one statement -- the broken-link purge's exit. Every id it is handed is a link,
    // which carries no blob and roots no subtree, so there is nothing to gather or graveyard first: the rows simply go.
    async hardDeleteMany(ids : readonly string[]) : Promise<void>
    {
        if(ids.length === 0) { return; }

        await this.#db
            .deleteFrom('node')
            .where('id', 'in', ids)
            .execute();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Derived aggregates
    //------------------------------------------------------------------------------------------------------------------

    // The quota charge for a user: the total logical size of the file nodes they own, trashed included and folders and
    // links (which have no size) excluded. Runs on every upload admission -- one aggregate covered end to end by
    // node_owner_size_idx. Postgres sum(bigint) comes back as a numeric string and SQLite as a number; Number spans
    // both.
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

    // The same charge for a batch of owners in one grouped aggregate -- the admin listing's usage column. Owners
    // with no file nodes simply have no row; the map answers 0 for them.
    async ownedBytesByOwner(ownerIDs : string[]) : Promise<Map<string, number>>
    {
        if(ownerIDs.length === 0) { return new Map(); }

        const rows = await this.#db
            .selectFrom('node')
            .select([ 'owner_id', sql<string | number>`coalesce(sum(size), 0)`.as('total') ])
            .where('owner_id', 'in', ownerIDs)
            .where('type', '=', 'file')
            .groupBy('owner_id')
            .execute();

        return new Map(rows.map((row) => [ row.owner_id, Number(row.total) ]));
    }

    // The same charge summed across every owner -- what the whole instance is holding on paper, before dedup. Trashed
    // files still count, exactly as they still count against their owner's quota until a purge removes the row.
    async totalOwnedBytes() : Promise<number>
    {
        const row = await this.#db
            .selectFrom('node')
            .select(sql<string | number>`coalesce(sum(size), 0)`.as('total'))
            .where('type', '=', 'file')
            .executeTakeFirstOrThrow();

        return Number(row.total);
    }

    // How many live files and folders exist instance-wide. Trashed nodes are excluded -- they are counted (and
    // charged) separately as trash -- and links are counted as neither, being pointers rather than content.
    async liveTypeCounts() : Promise<{ files : number; folders : number }>
    {
        const row = await this.#db
            .selectFrom('node')
            .select([
                sql<string | number>`coalesce(sum(case when type = 'file' then 1 else 0 end), 0)`.as('files'),
                sql<string | number>`coalesce(sum(case when type = 'folder' then 1 else 0 end), 0)`.as('folders'),
            ])
            .where('trashed_at', 'is', null)
            .executeTakeFirstOrThrow();

        return { files: Number(row.files), folders: Number(row.folders) };
    }

    // What is sitting in trash instance-wide: file nodes trashed but not yet purged, and the bytes they still charge.
    // Every node in a trashed subtree carries its own trashed_at, so nested files are counted individually.
    async trashedFileTotals() : Promise<{ count : number; bytes : number }>
    {
        const row = await this.#db
            .selectFrom('node')
            .select([
                sql<string | number>`count(*)`.as('count'),
                sql<string | number>`coalesce(sum(size), 0)`.as('bytes'),
            ])
            .where('type', '=', 'file')
            .where('trashed_at', 'is not', null)
            .executeTakeFirstOrThrow();

        return { count: Number(row.count), bytes: Number(row.bytes) };
    }
}

//----------------------------------------------------------------------------------------------------------------------
