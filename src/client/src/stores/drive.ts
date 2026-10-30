//----------------------------------------------------------------------------------------------------------------------
// Drive Store
//
// A folder arrives in chunks: the first paints and the rest follow, so all but the largest folders are whole a moment
// after opening. Once whole, sorting and filtering are local array work with no request behind them and no scroll
// reset; past the ceiling the listing keeps loading as the viewport reaches for it, and both stay the server's.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    LISTING_CHUNK_SIZE,
    MAX_TREE_DEPTH,
    type NodeListResponse,
    type NodeResponse,
    type NodeSortKey,
    type NodeTypeFamily,
    type SortDirection,
    type UserSummary,
} from '@fileshed/core';

// Engines
import { type ModifiedFilter, listing } from '../engines/listing/index.ts';

// Stores
import { createChunkedListing } from './chunkedListing.ts';
import { commitFile } from './commitFile.ts';
import { createListingFilters } from './listingFilters.ts';
import { useSessionStore } from './session.ts';

// Resource Access
import {
    copyNode,
    createNode,
    getNode,
    hardDeleteNode,
    listChildren,
    patchNode,
    trashNode,
} from '../resource-access/nodes.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useDriveStore = defineStore('drive', () =>
{
    const session = useSessionStore();

    const folderID = ref<string | null>(null);

    const sortKey = ref<NodeSortKey>('name');
    const sortDirection = ref<SortDirection>('asc');
    const loading = ref(false);
    const error = ref<Error | null>(null);
    const breadcrumb = ref<NodeResponse[]>([]);

    // The chain is foreign when it does not root in the caller's own tree: either the physical walk topped out
    // before reaching a null parent (the topmost entry still has one, just unresolved), or it reached a null parent
    // owned by someone else. An empty chain is the files root itself, always own-tree. A logical-prefix-seeded chain
    // (a descent through a link) never recomputes this -- it inherits the anchor for free, since seeding only
    // appends to breadcrumb and entry 0 never changes.
    const breadcrumbForeign = computed(() =>
    {
        const root = breadcrumb.value[0];
        if(root === undefined) { return false; }

        return root.parentID !== null || root.ownerID !== session.me?.id;
    });

    // The active filters and the owner facet the current folder faces. The facet is the whole folder's distinct
    // owners, so the owner menu is complete even while an owner filter narrows the listing.
    const filters = createListingFilters();
    const owners = ref<UserSummary[]>([]);

    // Folder nodes keyed by id, reused across navigation so a breadcrumb walk re-fetches only the levels it has never
    // seen. Seeded from every listing, so descending into a folder already carries its own node.
    const nodeCache = new Map<string, NodeResponse>();

    // Every owner summary any listing has disclosed, keyed by user id. The current-folder facet is scoped to the open
    // folder, but a link breadcrumb keeps standing after the user descends past it, and its hover card still needs the
    // target owner's summary -- carried here from the listing that traversed the link, so it survives the descent.
    const ownerDirectory = ref(new Map<string, UserSummary>());
    const knownOwners = computed(() => [ ...ownerDirectory.value.values() ]);

    //------------------------------------------------------------------------------------------------------------------

    function cacheNodes(nodes : readonly NodeResponse[]) : void
    {
        for(const node of nodes) { nodeCache.set(node.id, node); }
    }

    // Merge a listing's owner facet into the standing directory. Reassigning a fresh Map keeps the computed reactive.
    function rememberOwners(list : readonly UserSummary[]) : void
    {
        if(list.length === 0) { return; }

        const next = new Map(ownerDirectory.value);
        for(const summary of list) { next.set(summary.id, summary); }
        ownerDirectory.value = next;
    }

    async function resolveNode(id : string) : Promise<NodeResponse>
    {
        const cached = nodeCache.get(id);
        if(cached !== undefined) { return cached; }

        const node = await getNode(id);
        nodeCache.set(id, node);

        return node;
    }

    // Walk parentID from the current folder up to My Files, newest ancestor last. The depth cap mirrors the server's
    // tree ceiling so a corrupt parent edge bounds the walk instead of spinning it.
    async function buildBreadcrumb(target : string | null) : Promise<void>
    {
        const chain : NodeResponse[] = [];
        let cursor = target;
        let depth = 0;

        while(cursor !== null && depth < MAX_TREE_DEPTH)
        {
            // An ancestor the caller can't resolve (a shared target folder whose parents are out of reach) tops out the
            // chain rather than failing the whole load -- the listing itself is already in hand. The walk is a chain:
            // each level's parent is only known once its child resolves, so the awaits are necessarily sequential.
            let node : NodeResponse;
            // eslint-disable-next-line no-await-in-loop
            try { node = await resolveNode(cursor); }
            catch { break; }

            chain.unshift(node);
            cursor = node.parentID;
            depth += 1;
        }

        breadcrumb.value = chain;
    }

    //------------------------------------------------------------------------------------------------------------------

    async function fetchChunk(offset : number, filtered : boolean) : Promise<NodeListResponse>
    {
        return listChildren(folderID.value, {
            limit: LISTING_CHUNK_SIZE,
            offset,
            sortKey: sortKey.value,
            sortDirection: sortDirection.value,
            ...(filtered ? filters.query() : {}),
        });
    }

    // The owner facet spans the whole folder, so every chunk carries the same one.
    function absorbPage(page : NodeListResponse) : void
    {
        owners.value = page.owners;
        rememberOwners(page.owners);
        cacheNodes(page.nodes);
    }

    // The rows in hand and the chunk reads that fill them.
    const rows = createChunkedListing({ fetchChunk, onPage: absorbPage });

    // What the surface renders. While the folder is still arriving it is what has arrived, in the order it arrived;
    // once it is whole the client owns the presentation -- it narrows and orders the rows itself, so a sort or a
    // filter costs no request and moves no scrollbar.
    const children = computed<NodeResponse[]>(() =>
    {
        const inHand = rows.loaded.value;
        if(!rows.complete.value) { return inHand; }

        const shown = rows.whole.value ? listing.filter.filterNodes(inHand, filters.current()) : inHand;

        return listing.order.sortNodes(shown, sortKey.value, sortDirection.value);
    });

    const isEmpty = computed(() => !loading.value && error.value === null && children.value.length === 0);

    // The children came back empty because a filter excluded everything, not because the folder is bare -- the surface
    // says so and offers to clear, rather than showing the plain empty-folder state.
    const filteredEmpty = computed(() => isEmpty.value && filters.active.value);

    //------------------------------------------------------------------------------------------------------------------

    async function load(target : string | null) : Promise<void>
    {
        const sameFolder = target === folderID.value;

        // The child we are descending into, read off the CURRENT listing before it is replaced: a click on a node in
        // view. Its logical breadcrumb is the chain now on screen plus itself -- the piece the physical parent walk
        // cannot rebuild once the chain passes through a folder link, whose target's ancestors are out of the caller's
        // reach. A sidebar jump or a pasted URL names a folder that is not in view, so it finds no child here and falls
        // to the physical walk; reading it off the live listing is what keeps a stale chain from ever leaking.
        const descended = sameFolder ? null : children.value.find((node) => node.id === target) ?? null;
        const priorChain = breadcrumb.value;

        // Navigating to a different folder drops the filters: a type or owner filter meaningful in one folder is noise
        // in the next, and a stale owner filter would face an owner the new folder may not even have. A same-folder
        // reload (sort or a filter change) keeps them, since that is exactly the reload those actions want.
        if(!sameFolder) { filters.reset(); }

        const filtered = rows.shouldFilterOnServer(filters.active.value);
        const token = rows.begin();

        folderID.value = target;
        loading.value = true;
        error.value = null;

        try
        {
            if(!await rows.replaceWithFirstChunk(token, filtered)) { return; }

            // A same-folder reload leaves the open folder unchanged, so its breadcrumb stands. A descent extends the
            // chain on screen; anything else (a cold load, a jump) walks the parent edges from scratch.
            if(!sameFolder)
            {
                if(descended !== null) { breadcrumb.value = [ ...priorChain, descended ]; }
                else { await buildBreadcrumb(target); }
            }
        }
        catch(caught)
        {
            if(!rows.isCurrent(token)) { return; }

            error.value = caught instanceof Error ? caught : new Error('Failed to load this folder.');
            rows.clear();
            owners.value = [];
            breadcrumb.value = [];
        }
        finally
        {
            if(rows.isCurrent(token)) { loading.value = false; }
        }

        await rows.fillRest(token);
    }

    // Re-read the open folder from the top. A mutation calls this so the surface reflects the change; the rest of the
    // folder follows behind the first chunk exactly as it does on a fresh load.
    async function refresh() : Promise<void>
    {
        await rows.refresh(rows.shouldFilterOnServer(filters.active.value));
    }

    // Re-read one node and swap it into the open listing, leaving the page the user has paged open alone. The share
    // dialog calls this after every grant, revoke, publish, or kill, so the badges and the copy-link entries follow
    // without a reload. It asks the server rather than mirroring the mutation: what still stands is the server's to
    // say. A node that has left the listing simply is not there to replace.
    async function refreshSharingFor(nodeID : string) : Promise<void>
    {
        const current = await getNode(nodeID);

        rows.loaded.value = rows.loaded.value.map((node) =>
        {
            return node.id === nodeID ? current : node;
        });
        cacheNodes([ current ]);
    }

    // A folder in hand re-orders where it stands: no request, no spinner, and the scrollbar doesn't move. One still
    // arriving, or one past the ceiling, re-reads -- the order of rows the client has never seen is the server's.
    async function reSort(key : NodeSortKey, direction : SortDirection) : Promise<void>
    {
        sortKey.value = key;
        sortDirection.value = direction;

        if(rows.complete.value) { return; }

        await load(folderID.value);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each sets its slice of the filter state, then narrows the folder in hand or re-reads it narrowed.
    // A re-read targets the same folder, which is why load keeps the filters instead of clearing them.
    //------------------------------------------------------------------------------------------------------------------

    async function applyFilters() : Promise<void>
    {
        if(rows.whole.value) { return; }

        await load(folderID.value);
    }

    async function setTypeFamilies(families : NodeTypeFamily[]) : Promise<void>
    {
        filters.typeFamilies.value = [ ...families ];
        await applyFilters();
    }

    async function setOwner(next : UserSummary | null) : Promise<void>
    {
        filters.owner.value = next;
        await applyFilters();
    }

    async function setModified(next : ModifiedFilter | null) : Promise<void>
    {
        filters.modified.value = next;
        await applyFilters();
    }

    async function clearFilters() : Promise<void>
    {
        filters.reset();
        await applyFilters();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Mutations -- each calls the RA, then refetches the current folder. Errors propagate to the caller.
    //------------------------------------------------------------------------------------------------------------------

    async function createFolder(name : string) : Promise<void>
    {
        await createNode({ type: 'folder', name, parentID: folderID.value });
        await refresh();
    }

    // A link placed in a folder of the caller's own, pointing at a node they can read. The destination defaults to
    // the open folder -- which is what "New -> Link" means -- and is named explicitly when the placement was chosen
    // in a picker instead. The name is left to the server, which takes the target's own.
    async function createLink(targetNodeID : string, parentID : string | null = folderID.value) : Promise<void>
    {
        await createNode({ type: 'link', targetNodeID, parentID });
        await refresh();
    }

    async function rename(id : string, name : string) : Promise<void>
    {
        await patchNode(id, { name });
        await refresh();
    }

    async function move(id : string, destinationParentID : string | null) : Promise<void>
    {
        await patchNode(id, { parentID: destinationParentID });
        await refresh();
    }

    async function trash(id : string) : Promise<void>
    {
        await trashNode(id);
        await refresh();
    }

    // A file copied into the current folder unless a destination is named. The copy charges the caller's quota, so
    // the gauge refreshes.
    async function copy(id : string, destinationParentID : string | null = folderID.value) : Promise<void>
    {
        await copyNode(id, { parentID: destinationParentID });
        await refresh();
        await session.refreshProfile();
    }

    // A new empty file in the current folder, returned so a caller can navigate straight into it.
    async function createEmptyFile(name : string, mimeType : string) : Promise<NodeResponse>
    {
        const empty = new File([], name, { type: mimeType });
        const created = await commitFile(empty, { name, parentID: folderID.value, mimeType });

        await refresh();
        return created;
    }

    async function removeDeadLink(id : string) : Promise<void>
    {
        await hardDeleteNode(id);
        await refresh();
    }

    //------------------------------------------------------------------------------------------------------------------

    return {
        folderID,
        children,
        total: rows.total,
        sortKey,
        sortDirection,
        loading,
        error,
        breadcrumb,
        breadcrumbForeign,
        typeFamilies: filters.typeFamilies,
        owner: filters.owner,
        modified: filters.modified,
        owners,
        knownOwners,
        capped: rows.capped,
        complete: rows.complete,
        isEmpty,
        hasActiveFilters: filters.active,
        filteredEmpty,
        load,
        reachedIndex: rows.reachedIndex,
        refresh,
        refreshSharingFor,
        reSort,
        setTypeFamilies,
        setOwner,
        setModified,
        clearFilters,
        createFolder,
        createLink,
        rename,
        move,
        trash,
        copy,
        createEmptyFile,
        removeDeadLink,
    };
});

//----------------------------------------------------------------------------------------------------------------------
