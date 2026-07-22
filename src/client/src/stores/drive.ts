//----------------------------------------------------------------------------------------------------------------------
// Drive Store
//
// The state and orchestration behind the drive view: which folder is open, its children accumulated a page at a time,
// the sort in force, and the breadcrumb chain from My Files down to the current folder. Mutations (new folder, new
// empty file, rename, move, trash, copy, remove-dead-link) call the RA then refetch the current folder -- there is no
// query cache to invalidate, so the store re-reads what it changed. Regulation and API errors from mutations propagate
// to the caller so the view can toast them; a failed listing lands in `error` for the surface's retry state instead.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

import {
    type ChildrenQuery,
    DEFAULT_CHILDREN_LIMIT,
    MAX_CHILDREN_LIMIT,
    MAX_TREE_DEPTH,
    type NodeResponse,
    type NodeSortKey,
    type NodeTypeFamily,
    type SortDirection,
    type UserSummary,
} from '@fileshed/core';

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
    const folderID = ref<string | null>(null);
    const children = ref<NodeResponse[]>([]);
    const total = ref(0);
    const sortKey = ref<NodeSortKey>('name');
    const sortDirection = ref<SortDirection>('asc');
    const loading = ref(false);
    const loadingMore = ref(false);
    const error = ref<Error | null>(null);
    const breadcrumb = ref<NodeResponse[]>([]);

    // The active filters (server-applied) and the owner facet the current folder faces. The facet is the whole folder's
    // distinct owners, so the owner menu is complete even while an owner filter narrows the listing.
    const typeFamilies = ref<NodeTypeFamily[]>([]);
    const owner = ref<UserSummary | null>(null);
    const modified = ref<ModifiedFilter | null>(null);
    const owners = ref<UserSummary[]>([]);

    // Folder nodes keyed by id, reused across navigation so a breadcrumb walk re-fetches only the levels it has never
    // seen. Seeded from every listing, so descending into a folder already carries its own node.
    const nodeCache = new Map<string, NodeResponse>();

    const hasMore = computed(() => children.value.length < total.value);
    const isEmpty = computed(() => !loading.value && error.value === null && children.value.length === 0);
    const hasActiveFilters = computed(
        () => typeFamilies.value.length > 0 || owner.value !== null || modified.value !== null
    );

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

    async function load(target : string | null) : Promise<void>
    {
        // Navigating to a different folder drops the filters: a type or owner filter meaningful in one folder is noise
        // in the next, and a stale owner filter would face an owner the new folder may not even have. A same-folder
        // reload (sort or a filter change) keeps them, since that is exactly the reload those actions want.
        if(target !== folderID.value) { resetFilters(); }

        folderID.value = target;
        loading.value = true;
        error.value = null;

        try
        {
            const page = await getChildren(target, {
                limit: DEFAULT_CHILDREN_LIMIT,
                offset: 0,
                sortKey: sortKey.value,
                sortDirection: sortDirection.value,
                ...filterParams(),
            });

            children.value = page.nodes;
            total.value = page.total;
            owners.value = page.owners;
            cacheNodes(page.nodes);
            await buildBreadcrumb(target);
        }
        catch(caught)
        {
            error.value = caught instanceof Error ? caught : new Error('Failed to load this folder.');
            children.value = [];
            total.value = 0;
            owners.value = [];
            breadcrumb.value = [];
        }
        finally
        {
            loading.value = false;
        }
    }

    async function loadMore() : Promise<void>
    {
        if(loadingMore.value || !hasMore.value) { return; }

        loadingMore.value = true;
        try
        {
            const page = await getChildren(folderID.value, {
                limit: DEFAULT_CHILDREN_LIMIT,
                offset: children.value.length,
                sortKey: sortKey.value,
                sortDirection: sortDirection.value,
                ...filterParams(),
            });

            children.value = [ ...children.value, ...page.nodes ];
            total.value = page.total;
            owners.value = page.owners;
            cacheNodes(page.nodes);
        }
        finally
        {
            loadingMore.value = false;
        }
    }

    // Re-read the current folder, holding the window the user has paged open. A mutation calls this so the surface
    // reflects the change without collapsing back to the first page.
    async function refresh() : Promise<void>
    {
        const window = Math.min(Math.max(children.value.length, DEFAULT_CHILDREN_LIMIT), MAX_CHILDREN_LIMIT);
        const page = await getChildren(folderID.value, {
            limit: window,
            offset: 0,
            sortKey: sortKey.value,
            sortDirection: sortDirection.value,
            ...filterParams(),
        });

        children.value = page.nodes;
        total.value = page.total;
        owners.value = page.owners;
        cacheNodes(page.nodes);
    }

    async function reSort(key : NodeSortKey, direction : SortDirection) : Promise<void>
    {
        sortKey.value = key;
        sortDirection.value = direction;

        await load(folderID.value);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Filters -- each sets its slice of the filter state and reloads the current folder from the first page (a filter
    // change resets pagination). load keeps the filters because the reload targets the same folder.
    //------------------------------------------------------------------------------------------------------------------

    async function setTypeFamilies(families : NodeTypeFamily[]) : Promise<void>
    {
        typeFamilies.value = [ ...families ];
        await load(folderID.value);
    }

    async function setOwner(next : UserSummary | null) : Promise<void>
    {
        owner.value = next;
        await load(folderID.value);
    }

    async function setModified(next : ModifiedFilter | null) : Promise<void>
    {
        modified.value = next;
        await load(folderID.value);
    }

    async function clearFilters() : Promise<void>
    {
        resetFilters();
        await load(folderID.value);
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

    // A file copied into the current folder unless a destination is named.
    async function copy(id : string, destinationParentID : string | null = folderID.value) : Promise<void>
    {
        await copyNode(id, { parentID: destinationParentID });
        await refresh();
    }

    // A new empty file in the current folder. Zero-byte content claims a universal digest, so the claim answers with a
    // ticket whether the blob is new or already known (it is always below the small-file threshold); the challenge
    // branch is here for completeness only.
    async function createEmptyFile(name : string, mimeType : string) : Promise<void>
    {
        const claim = await claimBlob({ sha256: EMPTY_BLOB_SHA256, size: 0 });
        const placement = { name, parentID: folderID.value, mimeType };

        if(claim.upload)
        {
            await uploadTicket(claim.ticket, new Uint8Array(0), placement);
        }
        else
        {
            await answerChallenge(claim.challengeID, { answer: await emptyBlobProof(claim.nonce), ...placement });
        }

        await refresh();
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
        loadingMore,
        error,
        breadcrumb,
        typeFamilies,
        owner,
        modified,
        owners,
        hasMore,
        isEmpty,
        hasActiveFilters,
        filteredEmpty,
        load,
        loadMore,
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
