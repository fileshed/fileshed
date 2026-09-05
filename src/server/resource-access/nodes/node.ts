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
    LISTING_SORT_FIELDS,
    type LinkNode,
    type ListingOrderRow,
    type ListingSortField,
    MAX_TREE_DEPTH,
    MIME_FAMILY_SPECS,
    NATURAL_ORDER_COLLATION,
    type Node,
    type NodeTypeFamily,
    PLAYLIST_EXTENSIONS,
    PLAYLIST_MIME_LIST,
    SQLITE_MAX_SORTED_IN_MEMORY,
    SQLITE_MAX_SORTED_NAME_CHARS,
    type UserSummary,
    compareListingNodes,
} from '@fileshed/core';

// Resource Access
import type { Database, DatabaseHandle, DatabaseKind } from '../database/database.ts';
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

// Everything one caller may resolve a role on: the nodes they own, the nodes granted to them, and -- by descending
// parent edges from those -- everything underneath either. The same rule the permission resolver applies node by
// node, stated from the top down so a query can be scoped by it rather than filtered by it afterwards.
// `grantedNodeIDs` comes from the share RA, which owns the grant rows.
export interface AccessScope
{
    userID : string;
    grantedNodeIDs : readonly string[];
}

// The column holding each field the listing order names. Which fields a key sorts by, in what order, is core's to
// say -- this is only where those fields live, and the mapping is what keeps a caller's sort key from ever reaching
// orderBy as raw SQL.
type SortColumn = 'name' | 'size' | 'created_at' | 'updated_at' | 'type' | 'mime_type';

const sortColumnOf : Record<ListingSortField, SortColumn> = {
    name: 'name',
    size: 'size',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    type: 'type',
    mimeType: 'mime_type',
};

// Several of these are nullable -- size on links, mime_type on anything that is not a file -- and the two dialects
// disagree about where an absent value belongs: Postgres sorts nulls high, SQLite sorts them low. Every listing that
// orders by one of these states the placement explicitly, so a page does not depend on which database is underneath
// it, and it states the one core states: absent after present, which the direction then flips.
function sortColumns(key : NodeSortKey) : readonly SortColumn[]
{
    return LISTING_SORT_FIELDS[key].map((field) => sortColumnOf[field]);
}

// The folded form every name-ordered listing sorts by, so `apple` sits beside `Apple` instead of behind a run of
// capitals. It also settles a dialect split: raw text orders by byte on SQLite and by locale on Postgres, and only one
// of those puts `Zebra` after `apple`. An index over the same expression is what keeps the folded ordering cheap.
function lowerName(column : 'name' | 'node.name') : Expression<string>
{
    return sql<string>`lower(${ sql.ref(column) })`;
}

// 0 for a folder, 1 for anything else: a plain integer key that sorts folders first on both dialects. CASE is
// portable, and sql.ref quotes the `type` column so the SQL keyword can never be read as bare identifier.
const folderRank = sql<number>`case when ${ sql.ref('type') } = 'folder' then 0 else 1 end`;

// Postgres orders names through the ICU collation migration 008 creates -- the same rule compareNames states and the
// client sorts by. SQLite reaches this only when a folder is too big to sort in Node (see #naturallySortedPage), and
// gets the folded lexical ordering that was the whole listing's before.
function naturalName(kind : DatabaseKind) : Expression<string>
{
    return kind === 'postgres'
        ? sql<string>`${ sql.ref('name') } collate ${ sql.ref(NATURAL_ORDER_COLLATION) }`
        : lowerName('name');
}

// Name is the one sort column that orders on a derived value rather than what is stored; every other column sorts as
// it sits.
function sortTarget(kind : DatabaseKind, column : SortColumn) : SortColumn | Expression<string>
{
    return column === 'name' ? naturalName(kind) : column;
}

type NodeExpressionBuilder = ExpressionBuilder<Database, 'node'>;

// The predicate a listing pages over, as conditions rather than a built query, so the two listings can hand the same
// selection to either ordering.
type NodeConditions = (eb : NodeExpressionBuilder) => Expression<SqlBool>[];

// The columns the in-Node ordering reads and nothing more: the whole selection crosses the wire to be ordered, and
// the page's rows are fetched by id once the order is known. Timestamps are compared as the fixed-width UTC text
// SQLite stores them as, which is how the client compares them too.
const SORT_KEY_COLUMNS = [ 'id', 'name', 'type', 'size', 'mime_type', 'created_at', 'updated_at' ] as const;

interface SortKeyRow
{
    id : string;
    name : string;
    type : Database['node']['type'];
    size : number | null;
    mime_type : string | null;
    created_at : string | Date;
    updated_at : string | Date;
}

function orderRow(row : SortKeyRow) : ListingOrderRow
{
    return {
        id: row.id,
        name: row.name,
        type: row.type,
        size: row.size,
        mimeType: row.mime_type,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

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

// The seed row of an access-scope descent, which joins each node to its parent to ask who owns the rung above.
type AccessRootExpressionBuilder = ExpressionBuilder<Database & { parent : Database['node'] }, 'node' | 'parent'>;

// Where a caller's reach BEGINS: a node they own whose parent they do not (their own root level included), or a node
// granted to them. A node under one of their own folders is not a root -- it is already reached by descending from
// one -- and seeding every owned node instead would walk each subtree once per rung above it.
function accessRootCondition(eb : AccessRootExpressionBuilder, scope : AccessScope) : Expression<SqlBool>
{
    const owned = eb.and([
        eb('node.owner_id', '=', scope.userID),
        eb.or([ eb('node.parent_id', 'is', null), eb('parent.owner_id', '<>', scope.userID) ]),
    ]);

    if(scope.grantedNodeIDs.length === 0) { return owned; }

    return eb.or([ owned, eb('node.id', 'in', [ ...scope.grantedNodeIDs ]) ]);
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
        return this.#page((eb) =>
        {
            const conditions : Expression<SqlBool>[] = [ eb('trashed_at', 'is', null) ];

            if(query.parentID === null)
            {
                conditions.push(eb('parent_id', 'is', null), eb('owner_id', '=', query.ownerID));
            }
            else { conditions.push(eb('parent_id', '=', query.parentID)); }

            if(filters !== undefined && hasFilters(filters)) { conditions.push(...filterConditions(eb, filters)); }

            return conditions;
        }, options);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Listing order
    //------------------------------------------------------------------------------------------------------------------

    // A page of one selection, ordered the way the whole product orders a listing. Postgres does it in SQL, where the
    // collation states the same rule; SQLite does it in Node, because it has no collation that orders naturally and JS
    // has no sort key to give it one. That applies to EVERY key, not only name: the tiebreak is a name, so a key
    // ordered in SQL on this dialect would settle its ties lexically while the client settles them naturally.
    async #page(conditions : NodeConditions, options : ChildrenOptions) : Promise<Node[]>
    {
        if(this.#kind === 'sqlite')
        {
            const page = await this.#naturallySortedPage(conditions, options.pagination, options.sort);

            if(page !== undefined) { return page; }
        }

        return this.#orderedPage(conditions, options);
    }

    async #orderedPage(conditions : NodeConditions, options : ChildrenOptions) : Promise<Node[]>
    {
        const { pagination, sort } = options;

        let builder = this.#db
            .selectFrom('node')
            .where((eb) => eb.and(conditions(eb)))
            .selectAll()
            .orderBy(folderRank, 'asc');

        for(const column of sortColumns(sort.key))
        {
            builder = builder.orderBy(sortTarget(this.#kind, column), (ob) =>
            {
                return sort.direction === 'asc' ? ob.asc().nullsLast() : ob.desc().nullsFirst();
            });
        }

        // The tiebreak, ascending whichever way the key ran: a reader who only reversed the direction should not see
        // rows the key cannot separate shuffle among themselves.
        const rows = await builder
            .orderBy(sortTarget(this.#kind, 'name'), 'asc')
            .orderBy('id', 'asc')
            .limit(pagination.limit)
            .offset(pagination.offset)
            .execute();

        return rows.map(nodeFromRow);
    }

    // Whether the whole selection's names can be held at once: how many rows it spans AND how many characters their
    // names come to, both asked in one aggregate BEFORE a single name crosses into Node. The size question has to be
    // answered in SQL, where a name costs one row's worth of memory at a time -- counting the characters as they
    // arrive would mean they had already arrived.
    async #fitsInMemorySort(conditions : NodeConditions) : Promise<boolean>
    {
        const row = await this.#db
            .selectFrom('node')
            .where((eb) => eb.and(conditions(eb)))
            .select((eb) => [
                eb.fn.countAll().as('rows'),
                sql<string | number>`coalesce(sum(length(name)), 0)`.as('chars'),
            ])
            .executeTakeFirstOrThrow();

        return Number(row.rows) <= SQLITE_MAX_SORTED_IN_MEMORY
            && Number(row.chars) <= SQLITE_MAX_SORTED_NAME_CHARS;
    }

    // The SQLite name ordering: pull the selection's sort keys, order them through the shared comparator, then fetch
    // only the page's rows. Undefined when the selection is too big to hold, which sends the caller back to the SQL
    // ordering rather than reading a folder it has already refused.
    //
    // Takes the direction rather than the whole sort, because this orders by name and nothing else. A folder sitting
    // exactly on the guard that grows mid-pagination switches orderings between one chunk and the next, which shifts
    // rows the client has already read; the offset pagination it rides on has the same exposure to a concurrent write.
    async #naturallySortedPage(
        conditions : NodeConditions,
        pagination : Pagination,
        sort : ChildrenOptions['sort']
    ) : Promise<Node[] | undefined>
    {
        if(!await this.#fitsInMemorySort(conditions)) { return undefined; }

        const keys = await this.#db
            .selectFrom('node')
            .where((eb) => eb.and(conditions(eb)))
            .select([ ...SORT_KEY_COLUMNS ])
            .limit(SQLITE_MAX_SORTED_IN_MEMORY + 1)
            .execute();

        // The row count was measured a query ago; this catches a folder that grew past the guard in between.
        if(keys.length > SQLITE_MAX_SORTED_IN_MEMORY) { return undefined; }

        keys.sort((left, right) => compareListingNodes(sort.key, sort.direction, orderRow(left), orderRow(right)));

        const page = keys.slice(pagination.offset, pagination.offset + pagination.limit);
        if(page.length === 0) { return []; }

        // The selection's own predicate rides along with the ids: a row trashed, restored, or moved out between the
        // two queries would otherwise come back and render in a state this listing does not model.
        const rows = await this.#db
            .selectFrom('node')
            .selectAll()
            .where((eb) => eb.and(conditions(eb)))
            .where('id', 'in', page.map((key) => key.id))
            .execute();

        const byID = new Map(rows.map((row) => [ row.id, row ]));

        // Whatever left the selection in between is dropped from the page rather than invented back into it.
        return page.flatMap((key) =>
        {
            const row = byID.get(key.id);

            return row === undefined ? [] : [ nodeFromRow(row) ];
        });
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

    // How far the subtree rooted at `id` reaches below `id` itself: 0 for a file, a link, or a childless folder. A
    // move carries the whole subtree, so this is what says whether a destination can hold it. Descends parent edges
    // only, bounded like every other walk -- a subtree already deeper than the bound answers with the bound, which is
    // over the placement ceiling and refuses the move.
    async subtreeHeight(id : string) : Promise<number>
    {
        const row = await this.#db
            .withRecursive('subtree(id, depth)', (qc) => qc
                .selectFrom('node')
                .select([ 'id', sql<number>`0`.as('depth') ])
                .where('id', '=', id)
                .unionAll(qc
                    .selectFrom('node as child')
                    .innerJoin('subtree', 'subtree.id', 'child.parent_id')
                    .select([ 'child.id', sql<number>`subtree.depth + 1`.as('depth') ])
                    .where('subtree.depth', '<', MAX_TREE_DEPTH)))
            .selectFrom('subtree')
            .select(sql<string | number>`coalesce(max(depth), 0)`.as('height'))
            .executeTakeFirstOrThrow();

        return Number(row.height);
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
    // both take an explicit ESCAPE so the pattern's escaped metacharacters behave identically.
    //
    // Every row this returns is one the caller can already resolve: the scope descends from their access roots and
    // the match runs over that set, so `limit` cuts THEIR matches. Names outside their reach never enter the window,
    // whatever they are and however early they sort.
    async searchByName(term : string, scope : AccessScope, limit : number) : Promise<Node[]>
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
            .withRecursive('reach(id, depth)', (qc) => qc
                .selectFrom('node')
                .leftJoin('node as parent', 'parent.id', 'node.parent_id')
                .select([ sql<string>`node.id`.as('id'), sql<number>`0`.as('depth') ])
                .where((eb) => accessRootCondition(eb, scope))
                .unionAll(qc
                    .selectFrom('node as child')
                    .innerJoin('reach', 'reach.id', 'child.parent_id')
                    .select([ 'child.id', sql<number>`reach.depth + 1`.as('depth') ])
                    // The same bound the resolver climbs with, so the two agree on what is reachable: a node further
                    // from its access root than the resolver will walk is out of both.
                    .where('reach.depth', '<', MAX_TREE_DEPTH)))
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
            .where('node.id', 'in', (eb) => eb.selectFrom('reach').select('id'))
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
        return this.#page((eb) =>
        {
            const conditions = trashedRootConditions(eb, ownerID);

            if(filters !== undefined && hasFilters(filters)) { conditions.push(...filterConditions(eb, filters)); }

            return conditions;
        }, options);
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
