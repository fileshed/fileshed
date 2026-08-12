//----------------------------------------------------------------------------------------------------------------------
// Drive Store
//
// The state and orchestration behind the drive view: which folder is open, its children, the sort in force, and the
// breadcrumb chain from My Files down to the current folder. A folder arrives in chunks -- the first paints, the rest
// follow behind it -- so all but the largest folders are whole within a moment of opening. Once whole, sorting and
// filtering are local array work with no request behind them and no scroll reset; past the ceiling the listing keeps
// loading as the viewport reaches for it and both stay the server's. Mutations call the RA then re-read the folder --
// there is no query cache to invalidate. Regulation and API errors from mutations propagate to the caller so the view
// can toast them; a failed listing lands in `error` for the surface's retry state instead.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    type ChildrenQuery,
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
import { type ListingFilters, listing } from '../engines/listing/index.ts';

// Stores
import { useSessionStore } from './session.ts';

// Resource Access
import {
    copyNode,
    createNode,
    getChildren,
    getNode,
    hardDeleteNode,
    patchNode,
    trashNode,
} from '../resource-access/nodes.ts';
import { answerChallenge, claimBlob, uploadTicket } from '../resource-access/blobs.ts';

// Utils
import { type ModifiedFilter, modifiedRange } from '../utils/filterPresets.ts';

//----------------------------------------------------------------------------------------------------------------------

// The SHA-256 of zero bytes: every empty file shares this digest, so they all dedup to a single blob -- by design.
const EMPTY_BLOB_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// The proof-of-possession answer for an empty blob: HMAC-SHA256 keyed by the nonce over zero sampled bytes, hex. Only
// reached if the server ever challenges an empty blob; below the small-file threshold it never does, but the answer is
// well-defined regardless.
async function emptyBlobProof(nonce : string) : Promise<string>
{
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(nonce),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        [ 'sign' ]
    );
    const signature = await crypto.subtle.sign('HMAC', key, new Uint8Array(0));

    return [ ...new Uint8Array(signature) ].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

//----------------------------------------------------------------------------------------------------------------------

export const useDriveStore = defineStore('drive', () =>
{
    const session = useSessionStore();

    const folderID = ref<string | null>(null);

    // The rows in hand, in the order the server sent them, and how many the current query has in all. What the surface
    // renders is `children` below -- these two are the raw material the chunk loop works against.
    const loaded = ref<NodeResponse[]>([]);
    const total = ref(0);

    // Whether the rows in hand came back from a request that carried the filters. It decides which side filtering
    // happens on from here: a narrowed listing can be narrowed further locally but never widened, so clearing a filter
    // over one has to go back to the server.
    const serverFiltered = ref(false);

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
    const typeFamilies = ref<NodeTypeFamily[]>([]);
    const owner = ref<UserSummary | null>(null);
    const modified = ref<ModifiedFilter | null>(null);
    const owners = ref<UserSummary[]>([]);

    // Folder nodes keyed by id, reused across navigation so a breadcrumb walk re-fetches only the levels it has never
    // seen. Seeded from every listing, so descending into a folder already carries its own node.
    const nodeCache = new Map<string, NodeResponse>();

    // Every owner summary any listing has disclosed, keyed by user id. The current-folder facet is scoped to the open
    // folder, but a link breadcrumb keeps standing after the user descends past it, and its hover card still needs the
    // target owner's summary -- carried here from the listing that traversed the link, so it survives the descent.
    const ownerDirectory = ref(new Map<string, UserSummary>());
    const knownOwners = computed(() => [ ...ownerDirectory.value.values() ]);

    // Past the ceiling the folder is too big to hold whole: it loads as the viewport reaches for it, and its order and
    // its filtering stay the server's. `complete` is every row of the current query in hand; `wholeFolder` is that AND
    // nothing having narrowed it on the way in, which is what makes a filter change a local narrowing.
    const capped = computed(() => listing.chunks.isCapped(total.value));
    const complete = computed(() => listing.chunks.isComplete(loaded.value.length, total.value));
    const wholeFolder = computed(() => complete.value && !serverFiltered.value);

    const hasActiveFilters = computed(
        () => typeFamilies.value.length > 0 || owner.value !== null || modified.value !== null
    );

    // The current filters as the listing engine states them.
    function localFilters() : ListingFilters
    {
        const window = modified.value === null ? {} : modifiedRange(modified.value);

        return {
            types: typeFamilies.value,
            ownerID: owner.value?.id ?? null,
            after: window.after ?? null,
            before: window.before ?? null,
        };
    }

    // What the surface renders. While the folder is still arriving it is what has arrived, in the order it arrived;
    // once it is whole the client owns the presentation -- it narrows and orders the rows itself, so a sort or a
    // filter costs no request and moves no scrollbar.
    const children = computed<NodeResponse[]>(() =>
    {
        if(!complete.value) { return loaded.value; }

        const rows = wholeFolder.value ? listing.filter.filterNodes(loaded.value, localFilters()) : loaded.value;

        return listing.order.sortNodes(rows, sortKey.value, sortDirection.value);
    });

    const isEmpty = computed(() => !loading.value && error.value === null && children.value.length === 0);

    // The children came back empty because a filter excluded everything, not because the folder is bare -- the surface
    // says so and offers to clear, rather than showing the plain empty-folder state.
    const filteredEmpty = computed(() => isEmpty.value && hasActiveFilters.value);

    // The current filters as a children-query fragment: an empty type selection, absent owner, and absent date window
    // are all dropped so the server reads them as unfiltered.
    function filterParams() : Partial<ChildrenQuery>
    {
        const params : Partial<ChildrenQuery> = {};

        if(typeFamilies.value.length > 0) { params.types = [ ...typeFamilies.value ]; }
        if(owner.value !== null) { params.ownerID = owner.value.id; }
        if(modified.value !== null)
        {
            const window = modifiedRange(modified.value);
            if(window.after !== undefined) { params.updatedAfter = window.after; }
            if(window.before !== undefined) { params.updatedBefore = window.before; }
        }

        return params;
    }

    function resetFilters() : void
    {
        typeFamilies.value = [];
        owner.value = null;
        modified.value = null;
    }

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
    // Chunked reading -- a listing arrives one chunk at a time. `generation` marks which listing a chunk belongs to,
    // so anything still in flight for a folder the user has left lands nowhere.
    //------------------------------------------------------------------------------------------------------------------

    let generation = 0;
    let chunkInFlight = false;

    // A listing the client holds whole filters itself, so its reads go out unfiltered and stay whole. Anything else
    // leaves filtering to the server, the only side that can narrow rows the client has never seen. A navigation has
    // just cleared the filters, so it reads unfiltered whichever way this falls.
    function readsFiltered() : boolean
    {
        return !wholeFolder.value && hasActiveFilters.value;
    }

    async function fetchChunk(offset : number, filtered : boolean) : Promise<NodeListResponse>
    {
        return getChildren(folderID.value, {
            limit: LISTING_CHUNK_SIZE,
            offset,
            sortKey: sortKey.value,
            sortDirection: sortDirection.value,
            ...(filtered ? filterParams() : {}),
        });
    }

    function adopt(page : NodeListResponse, filtered : boolean) : void
    {
        loaded.value = page.nodes;
        total.value = page.total;
        serverFiltered.value = filtered;
        owners.value = page.owners;
        rememberOwners(page.owners);
        cacheNodes(page.nodes);
    }

    // A later chunk extends the rows and re-states the totals; the owner facet spans the whole folder, so every chunk
    // carries the same one.
    function append(page : NodeListResponse) : void
    {
        loaded.value = [ ...loaded.value, ...page.nodes ];
        total.value = page.total;
        owners.value = page.owners;
        rememberOwners(page.owners);
        cacheNodes(page.nodes);
    }

    // One chunk from where the rows leave off. A chunk that comes back empty answers false as a failure does: the
    // folder shrank under us, and a loop chasing a total it can no longer reach would never end.
    async function pullChunk(token : number) : Promise<boolean>
    {
        if(chunkInFlight || token !== generation) { return false; }

        chunkInFlight = true;
        try
        {
            const page = await fetchChunk(loaded.value.length, serverFiltered.value);
            if(token !== generation || page.nodes.length === 0) { return false; }

            append(page);

            return true;
        }
        catch
        {
            // A chunk that fails leaves the listing short rather than replacing what is already on screen with an
            // error state. Scrolling toward the end of it asks again.
            return false;
        }
        finally
        {
            chunkInFlight = false;
        }
    }

    // Pull the rest of the folder behind the first chunk, so it is whole moments after it paints. A folder past the
    // ceiling is left alone here -- it loads on demand instead.
    async function fillRest(token : number) : Promise<void>
    {
        while(token === generation && listing.chunks.shouldPrefetch(loaded.value.length, total.value))
        {
            // The next offset is only known once the chunk before it lands, so the reads are necessarily sequential.
            // eslint-disable-next-line no-await-in-loop
            const landed = await pullChunk(token);
            if(!landed) { return; }
        }
    }

    // How far down the listing the surface has rendered. A listing still short of its total pulls the next chunk
    // before the user arrives at the end of what is loaded -- this is what carries a folder past the ceiling, and what
    // picks a fill back up after a chunk failed.
    function reachedIndex(index : number) : void
    {
        if(listing.chunks.reachesEnd(index, loaded.value.length, total.value)) { void pullChunk(generation); }
    }

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
        if(!sameFolder) { resetFilters(); }

        const filtered = readsFiltered();
        const token = ++generation;

        folderID.value = target;
        loading.value = true;
        error.value = null;

        try
        {
            const page = await fetchChunk(0, filtered);
            if(token !== generation) { return; }

            adopt(page, filtered);

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
            if(token !== generation) { return; }

            error.value = caught instanceof Error ? caught : new Error('Failed to load this folder.');
            loaded.value = [];
            total.value = 0;
            owners.value = [];
            breadcrumb.value = [];
        }
        finally
        {
            if(token === generation) { loading.value = false; }
        }

        await fillRest(token);
    }

    // Re-read the open folder from the top. A mutation calls this so the surface reflects the change; the rest of the
    // folder follows behind the first chunk exactly as it does on a fresh load.
    async function refresh() : Promise<void>
    {
        const filtered = readsFiltered();
        const token = ++generation;

        const page = await fetchChunk(0, filtered);
        if(token !== generation) { return; }

        adopt(page, filtered);

        await fillRest(token);
    }

    // Re-read one node and swap it into the open listing, leaving the page the user has paged open alone. The share
    // dialog calls this after every grant, revoke, publish, or kill, so the badges and the copy-link entries follow
    // without a reload. It asks the server rather than mirroring the mutation: what still stands is the server's to
    // say. A node that has left the listing simply is not there to replace.
    async function refreshSharingFor(nodeID : string) : Promise<void>
    {
        const current = await getNode(nodeID);

        loaded.value = loaded.value.map((node) =>
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

        if(complete.value) { return; }

        await load(folderID.value);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each sets its slice of the filter state, then narrows the folder in hand or re-reads it narrowed.
    // A re-read targets the same folder, which is why load keeps the filters instead of clearing them.
    //------------------------------------------------------------------------------------------------------------------

    async function applyFilters() : Promise<void>
    {
        if(wholeFolder.value) { return; }

        await load(folderID.value);
    }

    async function setTypeFamilies(families : NodeTypeFamily[]) : Promise<void>
    {
        typeFamilies.value = [ ...families ];
        await applyFilters();
    }

    async function setOwner(next : UserSummary | null) : Promise<void>
    {
        owner.value = next;
        await applyFilters();
    }

    async function setModified(next : ModifiedFilter | null) : Promise<void>
    {
        modified.value = next;
        await applyFilters();
    }

    async function clearFilters() : Promise<void>
    {
        resetFilters();
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
        await session.refreshProfile().catch(() => undefined);
    }

    // A new empty file in the current folder, returned so a caller can navigate straight into it. Zero-byte content
    // claims a universal digest, so the claim answers with a ticket whether the blob is new or already known (it is
    // always below the small-file threshold); the challenge branch is here for completeness only.
    async function createEmptyFile(name : string, mimeType : string) : Promise<NodeResponse>
    {
        const claim = await claimBlob({ sha256: EMPTY_BLOB_SHA256, size: 0 });
        const placement = { name, parentID: folderID.value, mimeType };

        const created = claim.upload
            ? await uploadTicket(claim.ticket, new Uint8Array(0), placement)
            : await answerChallenge(claim.challengeID, { answer: await emptyBlobProof(claim.nonce), ...placement });

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
        total,
        sortKey,
        sortDirection,
        loading,
        error,
        breadcrumb,
        breadcrumbForeign,
        typeFamilies,
        owner,
        modified,
        owners,
        knownOwners,
        capped,
        complete,
        isEmpty,
        hasActiveFilters,
        filteredEmpty,
        load,
        reachedIndex,
        refresh,
        refreshSharingFor,
        reSort,
        setTypeFamilies,
        setOwner,
        setModified,
        clearFilters,
        createFolder,
        rename,
        move,
        trash,
        copy,
        createEmptyFile,
        removeDeadLink,
    };
});

//----------------------------------------------------------------------------------------------------------------------
