//----------------------------------------------------------------------------------------------------------------------
// Node Manager
//
// Business logic for a user's tree (requirements.md secs 3.2/4.4): create folders and links, rename/move, trash and
// restore, permanently delete, list children, and report the caller's own profile + quota. Every mutation follows the
// sec 3.6 shape -- gather the facts a judgement needs, run the regulation engine, then act -- so cross-record legality
// (parent-edge ownership, link-to-link, move cycles, trash rules) is decided in one pure place and turned into a typed
// RegulationError here. All I/O goes through NodeRA; the engine stays pure.
//
// v1 is pre-shares: a caller's effective role on a node is ownership or nothing (effectiveRole). That single helper is
// the seam shares extend later -- it is deliberately the only place role is derived, so nothing fakes more than
// ownership until the share resolver lands.
//----------------------------------------------------------------------------------------------------------------------

import { createId } from '@paralleldrive/cuid2';

// Models
import {
    type ChildrenQuery,
    type CreateFolderRequest,
    type CreateLinkRequest,
    ForbiddenError,
    type MeResponse,
    type Node,
    type NodeListResponse,
    type NodeResponse,
    NotFoundError,
    type PatchNodeRequest,
    RegulationError,
    type Role,
    toNodeResponse,
} from '@fileshed/core';

// Engines
import { type RegulationResult, regulation } from '../engines/regulation/index.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { type ChildrenOptions, type ChildrenQuery as NodeLocation, NodeRA } from '../resource-access/nodes/node.ts';

//----------------------------------------------------------------------------------------------------------------------

// The seam to blob graveyarding: after a subtree is hard-deleted, the shas of its files' blobs are handed here so the
// now-unreferenced ones can be graveyarded (requirements.md sec 4.2). The upload/GC side owns the implementation; the
// node manager only reports which blobs a delete may have orphaned. Passing an already-referenced sha is safe -- the
// handler re-derives the reference count and leaves live blobs alone. The optional executor lets the manager run this
// inside the same transaction as the delete that orphaned the blobs.
export interface OrphanedBlobs
{
    graveyardUnreferenced(shas : string[], executor ?: DatabaseHandle['db']) : Promise<void>;
}

// The caller's effective role on a node. v1 pre-shares: 'owner' if they own it, otherwise null (no access). When shares
// land this grows to max(ownership, direct/inherited grants) resolved against the target's real ancestor chain (sec
// 3.4); until then nothing may fake more than ownership.
function effectiveRole(actorID : string, node : Node) : Role | null
{
    return node.ownerID === actorID ? 'owner' : null;
}

//----------------------------------------------------------------------------------------------------------------------

export class NodeManager
{
    readonly #db : DatabaseHandle['db'];
    readonly #nodes : NodeRA;
    readonly #orphanedBlobs : OrphanedBlobs;

    constructor(handle : DatabaseHandle, nodes : NodeRA, orphanedBlobs : OrphanedBlobs)
    {
        this.#db = handle.db;
        this.#nodes = nodes;
        this.#orphanedBlobs = orphanedBlobs;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Reads
    //------------------------------------------------------------------------------------------------------------------

    async get(actor : SessionUser, id : string) : Promise<NodeResponse>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        const role = effectiveRole(actor.id, node);

        // A read of a node the caller has no access to reads as absent -- a 404 that never confirms the node exists.
        if(role === null) { throw new NotFoundError(`No node ${ id }.`); }

        return this.#respondNode(actor, node, role);
    }

    // `parentID` null lists the caller's root. Cross-owner contributions inside a shared folder (sec 3.3) are composed
    // in here once shares exist; v1 lists only the caller's own nodes under the location.
    async children(actor : SessionUser, parentID : string | null, query : ChildrenQuery) : Promise<NodeListResponse>
    {
        if(parentID !== null)
        {
            const parent = await this.#nodes.get(parentID);
            if(parent === undefined || effectiveRole(actor.id, parent) === null)
            {
                throw new NotFoundError(`No node ${ parentID }.`);
            }
        }

        const location : NodeLocation = { parentID, ownerID: actor.id };
        const options : ChildrenOptions = {
            pagination: { limit: query.limit, offset: query.offset },
            sort: { key: query.sortKey, direction: query.sortDirection },
        };

        const [ page, total ] = await Promise.all([
            this.#nodes.children(location, options),
            this.#nodes.countChildren(location),
        ]);

        const targets = await this.#resolveTargets(actor, page);

        const nodes = page.map((node) =>
        {
            // children lists only the caller's own nodes (the RA filters owner_id), so ownership is the effective role.
            if(node.type !== 'link') { return toNodeResponse(node, 'owner'); }
            return toNodeResponse(node, 'owner', targets.get(node.targetNodeID) ?? null);
        });

        return { nodes, total, limit: query.limit, offset: query.offset };
    }

    async me(actor : SessionUser) : Promise<MeResponse>
    {
        const used = await this.#nodes.ownedBytes(actor.id);

        return {
            id: actor.id,
            email: actor.email,
            name: actor.name,
            role: actor.role === 'admin' ? 'admin' : 'user',
            quota: { used, limit: actor.quotaLimit ?? null },
            createdAt: new Date(actor.createdAt).toISOString(),
        };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Create
    //------------------------------------------------------------------------------------------------------------------

    async createFolder(actor : SessionUser, request : CreateFolderRequest) : Promise<NodeResponse>
    {
        const parent = await this.#gatherParent(request.parentID);

        this.#enforce(this.#judgeParentEdge(actor, parent));

        const now = new Date();
        const node : Node = {
            type: 'folder',
            id: createId(),
            name: request.name,
            ownerID: actor.id,
            parentID: request.parentID,
            createdAt: now,
            updatedAt: now,
            trashedAt: null,
        };
        await this.#nodes.insert(node);

        return toNodeResponse(node, 'owner');
    }

    async createLink(actor : SessionUser, request : CreateLinkRequest) : Promise<NodeResponse>
    {
        const target = await this.#nodes.get(request.targetNodeID);
        if(target === undefined) { throw new NotFoundError(`No target node ${ request.targetNodeID }.`); }

        const parent = await this.#gatherParent(request.parentID);
        const id = createId();

        this.#enforce(regulation.combine([
            regulation.node.link({
                linkID: id,
                targetNodeID: target.id,
                targetType: target.type,
                creatorRoleOnTarget: effectiveRole(actor.id, target),
            }),
            this.#judgeParentEdge(actor, parent),
        ]));

        const now = new Date();
        // An unnamed link takes the target's current name at creation time (sec 3.2).
        const node : Node = {
            type: 'link',
            id,
            name: request.name ?? target.name,
            ownerID: actor.id,
            parentID: request.parentID,
            targetNodeID: target.id,
            createdAt: now,
            updatedAt: now,
        };
        await this.#nodes.insert(node);

        return this.#respondNode(actor, node, 'owner');
    }

    //------------------------------------------------------------------------------------------------------------------
    // Update
    //------------------------------------------------------------------------------------------------------------------

    // Rename and/or move, owner-only. Facts are gathered and judged before either write lands, so a rejected move never
    // leaves a half-applied rename behind.
    async patch(actor : SessionUser, id : string, patch : PatchNodeRequest) : Promise<NodeResponse>
    {
        const node = await this.#requireOwned(actor, id);

        if(patch.parentID !== undefined)
        {
            await this.#judgeMove(actor, node, patch.parentID);
        }

        if(patch.name !== undefined) { await this.#nodes.rename(id, patch.name); }
        if(patch.parentID !== undefined) { await this.#nodes.move(id, patch.parentID); }

        return this.#reread(actor, id);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Trash lifecycle
    //------------------------------------------------------------------------------------------------------------------

    async trash(actor : SessionUser, id : string) : Promise<NodeResponse>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        // judgeTrash owns both rules: links are deleted, never trashed (422), and only the owner may trash (403).
        this.#enforce(regulation.node.trash({ node, actorID: actor.id }));

        await this.#nodes.setTrashed(id, new Date());

        return this.#reread(actor, id);
    }

    async restore(actor : SessionUser, id : string) : Promise<NodeResponse>
    {
        const node = await this.#requireOwned(actor, id);

        // Restore returns the node where it was, unless its original parent is gone or still trashed -- then it lands
        // in the owner's root (requirements.md sec 4.4). setTrashed clears the whole subtree, so a restored folder
        // brings its descendants back with it.
        if(await this.#parentIsGoneOrTrashed(node))
        {
            await this.#nodes.move(id, null);
        }
        await this.#nodes.setTrashed(id, null);

        return this.#reread(actor, id);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Permanent delete
    //------------------------------------------------------------------------------------------------------------------

    async hardDelete(actor : SessionUser, id : string) : Promise<void>
    {
        const node = await this.#requireOwned(actor, id);

        // A link carries no blob and roots no subtree: removing the row detaches it from the tree only, leaving the
        // target node and its share untouched (requirements.md sec 3.2b). This is "remove from my drive".
        if(node.type === 'link')
        {
            await this.#nodes.hardDelete(id);
            return;
        }

        // Collect the subtree's blob shas BEFORE the delete removes the rows (read-only), then delete the subtree and
        // hand the shas to the graveyard in ONE transaction: a crash between them would strand the now-unreferenced
        // blobs (row gone, no graveyard marker, GC blind to them). graveyardUnreferenced re-derives each blob's
        // reference count against the post-delete rows, so a sha still referenced elsewhere stays live (requirements.md
        // secs 4.2/4.4). The delete cascades the whole subtree and every link pointing into it.
        const shas = await this.#nodes.subtreeFileBlobIDs(id);

        await this.#db.transaction().execute(async (trx) =>
        {
            await this.#nodes.hardDelete(id, trx);
            await this.#orphanedBlobs.graveyardUnreferenced(shas, trx);
        });
    }

    //------------------------------------------------------------------------------------------------------------------
    // Fact gathering & judgement
    //------------------------------------------------------------------------------------------------------------------

    async #gatherParent(parentID : string | null) : Promise<Node | null>
    {
        if(parentID === null) { return null; }

        const parent = await this.#nodes.get(parentID);
        if(parent === undefined) { throw new NotFoundError(`No parent node ${ parentID }.`); }

        return parent;
    }

    #judgeParentEdge(actor : SessionUser, parent : Node | null) : RegulationResult
    {
        return regulation.node.parentEdge({
            creatorID: actor.id,
            parent,
            creatorRoleOnParent: parent === null ? null : effectiveRole(actor.id, parent),
        });
    }

    async #judgeMove(actor : SessionUser, node : Node, newParentID : string | null) : Promise<void>
    {
        const parent = await this.#gatherParent(newParentID);
        const parentAncestorIDs = newParentID === null ? [] : await this.#nodes.ancestorIDs(newParentID);

        this.#enforce(regulation.combine([
            regulation.node.move({ nodeID: node.id, newParentID, parentAncestorIDs }),
            this.#judgeParentEdge(actor, parent),
        ]));
    }

    #enforce(verdict : RegulationResult) : void
    {
        if(!verdict.ok) { throw new RegulationError(verdict.violations); }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Ownership, target resolution, serialization
    //------------------------------------------------------------------------------------------------------------------

    // Fetch + owner gate for the owner-only mutations (rename/move/restore/delete). A missing node is 404; a node owned
    // by someone else is 403 -- these operations name the node the caller supplied, so we say plainly it is not theirs.
    async #requireOwned(actor : SessionUser, id : string) : Promise<Node>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }
        if(node.ownerID !== actor.id) { throw new ForbiddenError('Only the owner may modify this node.'); }

        return node;
    }

    async #parentIsGoneOrTrashed(node : Node) : Promise<boolean>
    {
        if(node.parentID === null) { return false; }

        const parent = await this.#nodes.get(node.parentID);

        // Gone (FK cascade makes this branch defensive) or a folder still in the trash: nowhere live to return to.
        return parent === undefined || (parent.type !== 'link' && parent.trashedAt !== null);
    }

    // Re-read after a write so the response carries the RA-stamped updated_at (and cleared/set trashed_at). The row is
    // the one we just wrote as owner, so 'owner' is the effective role.
    async #reread(actor : SessionUser, id : string) : Promise<NodeResponse>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        return this.#respondNode(actor, node, 'owner');
    }

    // Resolve a page of nodes' link targets in one round trip. A target the viewer cannot resolve -- the row is gone,
    // or access was lost -- is simply absent from the map, so the link serializes with a null target and renders as a
    // stub (requirements.md sec 3.2b).
    async #resolveTargets(actor : SessionUser, page : readonly Node[]) : Promise<Map<string, Node>>
    {
        const targetIDs = new Set<string>();
        for(const node of page)
        {
            if(node.type === 'link') { targetIDs.add(node.targetNodeID); }
        }

        const targets = await this.#nodes.getMany([ ...targetIDs ]);

        const resolved = new Map<string, Node>();
        for(const target of targets)
        {
            if(effectiveRole(actor.id, target) !== null) { resolved.set(target.id, target); }
        }

        return resolved;
    }

    async #respondNode(actor : SessionUser, node : Node, role : Role) : Promise<NodeResponse>
    {
        if(node.type !== 'link') { return toNodeResponse(node, role); }

        const target = await this.#nodes.get(node.targetNodeID);
        const resolved = target !== undefined && effectiveRole(actor.id, target) !== null ? target : null;

        return toNodeResponse(node, role, resolved);
    }
}

//----------------------------------------------------------------------------------------------------------------------
