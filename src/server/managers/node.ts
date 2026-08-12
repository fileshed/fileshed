//----------------------------------------------------------------------------------------------------------------------
// Node Manager
//
// Business logic for a user's tree: create folders and links, rename/move, trash and restore, permanently delete, list
// children, and report the caller's own profile + quota. Every mutation follows the same shape -- gather the facts a
// judgement needs, run the regulation engine, then act -- so cross-record legality (parent-edge ownership,
// link-to-link, move cycles, trash rules) is decided in one pure place and turned into a typed RegulationError here.
// All I/O goes through NodeRA; the engine stays pure.
//
// A caller's effective role on a node is resolved by the share RA -- max(ownership, direct grant, inherited grant)
// against the node's real ancestor chain. Every place role is derived reaches through that one resolver, so reads gate
// on it (a viewer can read, no access is 404), creates feed it to the parent-edge and link judges (an editor on a
// shared folder may create inside it), and link targets resolve against the viewer's own access -- links never conduct
// permission.
//----------------------------------------------------------------------------------------------------------------------

import { createId } from '@paralleldrive/cuid2';

// Models
import {
    type ChildrenQuery,
    type CopyNodeRequest,
    type CreateFolderRequest,
    type CreateLinkRequest,
    DEFAULT_GC_GRACE_DAYS,
    DEFAULT_TRASH_PURGE_DAYS,
    type DeletionOffer,
    type EmptyTrashResponse,
    type FileNode,
    ForbiddenError,
    MS_PER_DAY,
    type MeResponse,
    type Node,
    type NodeListResponse,
    type NodeLocation,
    type NodeResponse,
    type NodeSharing,
    NotFoundError,
    type PatchNodeRequest,
    type PurgeBrokenLinksResponse,
    RegulationError,
    type Role,
    SEARCH_CANDIDATE_LIMIT,
    type SearchQuery,
    type SearchResponse,
    type UpdatePreferencesRequest,
    type UserSummary,
    isDirectOwner,
    maxRole,
    permissionDemands,
    publicLinkPath,
    statementSatisfies,
    toNodeResponse,
    toUserPreferences,
} from '@fileshed/core';

// Engines
import { applyPreferencesPatch } from '../engines/preferences.ts';
import { effectiveQuota } from '../engines/quota.ts';
import { resolveLocation } from '../engines/location.ts';
import { type RegulationResult, regulation } from '../engines/regulation/index.ts';

// Managers
import type { Actor } from './session.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { DeletionOfferRA } from '../resource-access/deletionOffers/index.ts';
import {
    type ChildrenOptions,
    type ChildrenQuery as ListingRoot,
    type NodeFilters,
    NodeRA,
} from '../resource-access/nodes/node.ts';
import { PublicLinkRA } from '../resource-access/publicLinks/index.ts';
import { ShareRA } from '../resource-access/shares/index.ts';
import { UserRA } from '../resource-access/users/index.ts';

// Utils
import { avatarImage } from '../utils/avatarImage.ts';

//----------------------------------------------------------------------------------------------------------------------

// The seam to blob graveyarding: after a subtree is hard-deleted, the shas of its files' blobs are handed here so the
// now-unreferenced ones can be graveyarded. The upload/GC side owns the implementation; the node manager only reports
// which blobs a delete may have orphaned. Passing an already-referenced sha is safe -- the handler re-derives the
// reference count and leaves live blobs alone. The optional executor lets the manager run this inside the same
// transaction as the delete that orphaned the blobs.
export interface OrphanedBlobs
{
    graveyardUnreferenced(shas : string[], executor ?: DatabaseHandle['db']) : Promise<void>;
}

// The file facts a copy materializes into a fresh node the caller owns -- everything a file node needs except identity,
// owner, and placement. A save-a-copy builds this from a live source file; the deletion-offer accept path builds the
// same shape from an offer's stored snapshot, so the admit-and-insert seam takes this, not a source Node.
export interface FileCopySnapshot
{
    name : string;
    mimeType : string;
    size : number;
    blobID : string;
}

// The answer for a node that reaches no one, and the one a node just created always earns: no grants, no link. It
// costs no query, unlike the same answer arrived at by asking.
const NOTHING_SHARED : NodeSharing = { granteeCount: 0, linkUrl: null };

// Sharing answers to the sharing demand: a session sees it, an access token only with shares:read -- what
// GET /nodes/:id/links and GET /nodes/:id/shares already demand. A link URL is not a description of the capability,
// it IS the capability, so a files:read key must never harvest one off a listing it may otherwise read.
function maySeeSharing(caller : Actor) : boolean
{
    return caller.kind === 'session' || statementSatisfies(caller.permissions, permissionDemands.sharesRead);
}

// The tunables the manager reads rather than remembers: each is a supplier called at use time, so an admin moving one
// applies to the very next request instead of the next restart. An omitted supplier answers the shipped default --
// except defaultQuota, which every composition must state, because guessing it wrong fails open on storage.
export interface NodePolicy
{
    offerGraceMs ?: () => Promise<number>;
    trashRetentionDays ?: () => Promise<number>;
    defaultQuota : () => Promise<number>;
}

export class NodeManager
{
    readonly #db : DatabaseHandle['db'];
    readonly #kind : DatabaseHandle['kind'];
    readonly #nodes : NodeRA;
    readonly #shares : ShareRA;
    readonly #links : PublicLinkRA;
    readonly #offers : DeletionOfferRA;
    readonly #users : UserRA;
    readonly #orphanedBlobs : OrphanedBlobs;
    readonly #offerGraceMs : () => Promise<number>;
    readonly #trashRetentionDays : () => Promise<number>;
    readonly #defaultQuota : () => Promise<number>;

    constructor(handle : DatabaseHandle, nodes : NodeRA, orphanedBlobs : OrphanedBlobs, policy : NodePolicy)
    {
        this.#db = handle.db;
        this.#kind = handle.kind;
        this.#nodes = nodes;
        this.#shares = new ShareRA(handle);
        this.#links = new PublicLinkRA(handle);
        this.#offers = new DeletionOfferRA(handle);
        this.#users = new UserRA(handle);
        this.#orphanedBlobs = orphanedBlobs;
        this.#offerGraceMs = policy.offerGraceMs ?? (async () => DEFAULT_GC_GRACE_DAYS * MS_PER_DAY);
        this.#trashRetentionDays = policy.trashRetentionDays ?? (async () => DEFAULT_TRASH_PURGE_DAYS);
        this.#defaultQuota = policy.defaultQuota;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Reads
    //------------------------------------------------------------------------------------------------------------------

    async get(caller : Actor, id : string) : Promise<NodeResponse>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        const role = await this.#shares.effectiveRole(caller.user.id, node.id);

        // A read of a node the caller has no access to reads as absent -- a 404 that never confirms the node exists. A
        // viewer or editor resolves to a non-null role and reads it. A trashed node is likewise absent to everyone but
        // its direct owner: the resolver deliberately ignores trash state (a pure ancestor walk), so this guard is
        // where recipients lose sight of trashed items -- the same doctrine download and copy apply.
        if(role === null) { throw new NotFoundError(`No node ${ id }.`); }
        if(node.type !== 'link' && node.trashedAt !== null && !isDirectOwner(node, caller.user.id))
        {
            throw new NotFoundError(`No node ${ id }.`);
        }

        return this.#respondNode(caller, node, role);
    }

    // `parentID` null lists the caller's own root. A folder lists everything under it regardless of owner, so
    // contributions other users placed inside travel with the folder; no access to the folder reads as absent
    // (404). Each returned node carries the caller's real effective role.
    //
    // A folder-LINK id lists its target's children: the link is resolved to its target under the caller's OWN access
    // (links conduct no permission), and everything below then runs against the target exactly as if the target id had
    // been passed -- the same role composition, the same 404 for a dead or unreachable target.
    //
    // Roles are composed rather than re-walked: a child's ancestor chain is the child plus the parent's chain, and the
    // parent's chain is already folded into the parent's resolved role, so role(child) = max(parentRole,
    // ownership(child), direct grant on child). That is one recursive walk for the parent plus one flat grant lookup
    // for the page, instead of a walk per child.
    async children(caller : Actor, parentID : string | null, query : ChildrenQuery) : Promise<NodeListResponse>
    {
        const actor = caller.user;

        // null for a root listing: root-level nodes have no ancestors, so they carry no inherited role. The location
        // parent is the effective folder to list under -- the target for a folder-link parent, otherwise parentID.
        let parentRole : Role | null = null;
        let listedParentID = parentID;

        // Set when the listing traverses a folder link: the target's owner, added to the owner facet so the link
        // crumb's hover card has that owner's summary without a second round trip.
        let traversedTargetOwnerID : string | undefined;

        if(parentID !== null)
        {
            const parent = await this.#nodes.get(parentID);
            if(parent === undefined) { throw new NotFoundError(`No node ${ parentID }.`); }

            // A folder link lists its TARGET's children. Resolve it under the caller's own effective role on the
            // target, so each child carries the role children(targetID) would compose -- never anything the link
            // lends. The 404 message keeps the requested id, never the target's, so it discloses nothing.
            const listedParent = parent.type === 'link' ? await this.#nodes.get(parent.targetNodeID) : parent;
            if(listedParent === undefined) { throw new NotFoundError(`No node ${ parentID }.`); }

            parentRole = await this.#shares.effectiveRole(actor.id, listedParent.id);
            if(parentRole === null) { throw new NotFoundError(`No node ${ parentID }.`); }

            // A trashed folder is absent to everyone but its direct owner -- recipients get a 404, not an empty
            // listing that confirms the folder still exists. The owner keeps listing it: that is the trash view.
            const trashedTarget = listedParent.type !== 'link' && listedParent.trashedAt !== null;
            if(trashedTarget && !isDirectOwner(listedParent, actor.id))
            {
                throw new NotFoundError(`No node ${ parentID }.`);
            }

            listedParentID = listedParent.id;
            if(parent.type === 'link') { traversedTargetOwnerID = listedParent.ownerID; }
        }

        // ownerID scopes the ROOT listing only -- that is where per-user trees begin. A folder's listing is scoped by
        // the folder alone (NodeRA.children), which is what lets contributions by other owners appear.
        const listing : ListingRoot = { parentID: listedParentID, ownerID: actor.id };
        const options : ChildrenOptions = {
            pagination: { limit: query.limit, offset: query.offset },
            sort: { key: query.sortKey, direction: query.sortDirection },
        };
        const filters : NodeFilters = {
            types: query.types,
            ownerID: query.ownerID,
            name: query.name,
            updatedAfter: query.updatedAfter === undefined ? undefined : new Date(query.updatedAfter),
            updatedBefore: query.updatedBefore === undefined ? undefined : new Date(query.updatedBefore),
        };

        // The page and its total carry the filters; the owner facet does NOT -- it faces the whole folder so the filter
        // menu can always switch owners.
        const [ page, total, folderOwners ] = await Promise.all([
            this.#nodes.children(listing, options, filters),
            this.#nodes.countChildren(listing, filters),
            this.#nodes.ownersOf(listing),
        ]);

        const [ grants, targets, sharing ] = await Promise.all([
            this.#shares.directGrants(actor.id, page.map((node) => node.id)),
            this.#resolveTargets(actor, page),
            this.#sharingOf(caller, page),
        ]);

        const roleFor = (node : Node) : Role =>
        {
            const ownership : Role | null = isDirectOwner(node, actor.id) ? 'owner' : null;
            const role = maxRole(maxRole(parentRole, ownership), grants.get(node.id) ?? null);

            // Unreachable by construction: a root listing is filtered to the caller's own nodes, and every child of a
            // folder inherits that folder's non-null role. A null here means the listing and the permission model
            // disagree, so refuse loudly -- substituting a role would turn a resolver bug into a privilege grant.
            if(role === null) { throw new Error(`node ${ node.id } was listed without a resolvable role`); }

            return role;
        };

        const nodes = page.map((node) =>
        {
            const role = roleFor(node);
            const facts = { role, sharing: sharing.get(node.id) ?? null };
            if(node.type !== 'link') { return toNodeResponse(node, facts); }
            return toNodeResponse(node, { ...facts, target: targets.get(node.targetNodeID) ?? null });
        });

        const owners = await this.#withTargetOwners(folderOwners, targets, traversedTargetOwnerID);

        return { nodes, total, limit: query.limit, offset: query.offset, owners };
    }

    // Name search scoped to the nodes the caller can see. A name-match superset comes back from the RA (case-
    // insensitive on both dialects, trashed excluded, capped); every candidate's effective role resolves in ONE batch,
    // the ones that resolve to null (a stranger's files) drop out, and the survivors carry the role the caller earned.
    // Pagination runs over those survivors -- accessibility can't be pushed into the SQL pagination, so `total` is the
    // count the caller may actually reach, and a page never leaks a node they cannot resolve. Each hit also carries
    // where it lives, trimmed to the part of its ancestry the caller may see.
    async search(caller : Actor, query : SearchQuery) : Promise<SearchResponse>
    {
        const actor = caller.user;
        const candidates = await this.#nodes.searchByName(query.q, SEARCH_CANDIDATE_LIMIT);

        const roles = await this.#shares.effectiveRoles(actor.id, candidates.map((node) => node.id));
        const accessible = candidates.filter((node) => (roles.get(node.id) ?? null) !== null);

        const page = accessible.slice(query.offset, query.offset + query.limit);
        const targets = await this.#resolveTargets(actor, page);
        const owners = await this.#ownersOfPage(page, targets);
        const [ locations, sharing ] = await Promise.all([
            this.#locationsOf(actor, page),
            this.#sharingOf(caller, page),
        ]);

        const nodes = page.map((node) =>
        {
            const role = roles.get(node.id) ?? null;

            // Unreachable: `accessible` already dropped every null-role node. A null here means the filter and this
            // map disagree, so refuse loudly rather than stamp a role the resolver never granted.
            if(role === null) { throw new Error(`search returned node ${ node.id } without a resolvable role`); }

            const facts = { role, sharing: sharing.get(node.id) ?? null };
            if(node.type !== 'link') { return toNodeResponse(node, facts); }
            return toNodeResponse(node, { ...facts, target: targets.get(node.targetNodeID) ?? null });
        });

        // A search envelope spans many owners rather than one folder's worth, but the caller can already see every
        // node it returns, so the page's distinct owners disclose nothing a folder listing wouldn't.
        return {
            nodes,
            total: accessible.length,
            limit: query.limit,
            offset: query.offset,
            owners,
            locations,
        };
    }

    // What a page of nodes currently shares, keyed by node id. Only the caller's OWN nodes are asked about: listing a
    // node's grants or its links is owner-only authority everywhere else in the API, and a badge must not disclose what
    // the dialog behind it would refuse. An owned node always gets an entry, zeros included -- an absent one means "not
    // yours to know", which is a different answer from the owner's own "nothing is shared". A trashed node is hidden
    // from recipients and its links serve nothing until it is restored, so it reaches no one, and that answer costs no
    // query. The rest take two flat queries for the whole page, however long it is.
    async #sharingOf(caller : Actor, page : readonly Node[]) : Promise<Map<string, NodeSharing>>
    {
        const sharing = new Map<string, NodeSharing>();
        if(!maySeeSharing(caller)) { return sharing; }

        const liveIDs : string[] = [];
        for(const node of page)
        {
            if(isDirectOwner(node, caller.user.id) && node.type !== 'link')
            {
                if(node.trashedAt === null) { liveIDs.push(node.id); }
                else { sharing.set(node.id, NOTHING_SHARED); }
            }
        }
        if(liveIDs.length === 0) { return sharing; }

        const [ granteeCounts, links ] = await Promise.all([
            this.#shares.granteeCountsByNode(liveIDs),
            this.#links.liveLinksByNode(liveIDs),
        ]);

        for(const id of liveIDs)
        {
            const link = links.get(id);
            sharing.set(id, {
                granteeCount: granteeCounts.get(id) ?? 0,
                linkUrl: link === undefined ? null : publicLinkPath(link.token),
            });
        }

        return sharing;
    }

    // Where each hit on a page lives, keyed by node id. Two queries for the whole page however long it is: one
    // recursive walk gathering every hit's ancestor chain, then one batch role resolution over the distinct ancestors
    // those chains name. An ancestor the caller resolves to no role is absent from `visibleIDs`, which is what cuts a
    // chain at the share root -- the same resolver the read gate itself runs, so a location can only ever name folders
    // the caller could have opened directly.
    async #locationsOf(actor : SessionUser, page : readonly Node[]) : Promise<Record<string, NodeLocation>>
    {
        if(page.length === 0) { return {}; }

        const chains = await this.#nodes.ancestorChains(page.map((node) => node.id));

        const ancestorIDs = new Set<string>();
        for(const chain of chains.values())
        {
            for(const ancestor of chain) { ancestorIDs.add(ancestor.id); }
        }

        const roles = await this.#shares.effectiveRoles(actor.id, [ ...ancestorIDs ]);
        const visibleIDs = new Set([ ...ancestorIDs ].filter((id) => (roles.get(id) ?? null) !== null));

        const locations : Record<string, NodeLocation> = {};
        for(const node of page)
        {
            locations[node.id] = resolveLocation({
                ownerID: node.ownerID,
                parentID: node.parentID,
                ancestors: chains.get(node.id) ?? [],
                visibleIDs,
                actorID: actor.id,
            });
        }

        return locations;
    }

    // The caller's Trash view: the roots of their own trashed subtrees, paged and sorted like a folder listing. Every
    // node here is directly owned by the caller, so each carries the 'owner' role; roots-only, so a trashed folder
    // lists once and its descendants ride along rather than appearing on their own. An owner facet would name only the
    // caller themselves, so it carries none.
    async listTrash(actor : SessionUser, query : ChildrenQuery) : Promise<NodeListResponse>
    {
        const options : ChildrenOptions = {
            pagination: { limit: query.limit, offset: query.offset },
            sort: { key: query.sortKey, direction: query.sortDirection },
        };

        // The trash view honours the same Type/Modified filters a folder listing does. Owner and name never apply here:
        // the trash is already owner-scoped, and name is upload-collision detection, not a listing filter. The filters
        // ride the ROOT predicate, so roots-only holds -- a filter narrows which trashed roots list, never reaching
        // into the descendants riding along under a trashed folder.
        const filters : NodeFilters = {
            types: query.types,
            updatedAfter: query.updatedAfter === undefined ? undefined : new Date(query.updatedAfter),
            updatedBefore: query.updatedBefore === undefined ? undefined : new Date(query.updatedBefore),
        };

        const [ page, total ] = await Promise.all([
            this.#nodes.trashedRoots(actor.id, options, filters),
            this.#nodes.countTrashedRoots(actor.id, filters),
        ]);

        return {
            // Every node here is trashed, and a trashed node reaches no one: it is hidden from recipients and its
            // links serve nothing until it is restored. That answer costs no query (see #sharingOf).
            nodes: page.map((node) => toNodeResponse(node, { role: 'owner', sharing: NOTHING_SHARED })),
            total,
            limit: query.limit,
            offset: query.offset,
            owners: [],
        };
    }

    async me(actor : SessionUser) : Promise<MeResponse>
    {
        // The quota, preferences, and avatar all come from the row, not the session snapshot: the cookie cache lags a
        // just-saved value, so a page reload right after a change would otherwise show the stale one. For quota that
        // is not merely cosmetic -- the number shown here is the one the next upload is judged against.
        const [ used, limit, stored, avatarSha256, trashRetentionDays, defaultQuota ] = await Promise.all([
            this.#nodes.ownedBytes(actor.id),
            this.#users.quotaLimitOf(actor.id),
            this.#users.preferencesOf(actor.id),
            this.#users.avatarSha256Of(actor.id),
            this.#trashRetentionDays(),
            this.#defaultQuota(),
        ]);

        return {
            id: actor.id,
            email: actor.email,
            name: actor.name,
            role: actor.role === 'admin' ? 'admin' : 'user',
            quota: { used, effective: effectiveQuota(limit, defaultQuota), limit },
            limits: { trashRetentionDays },
            preferences: toUserPreferences(stored),
            image: avatarImage(avatarSha256),
            createdAt: new Date(actor.createdAt).toISOString(),
        };
    }

    // Merge a preferences patch into the caller's stored blob and answer the refreshed profile. The stored blob is read
    // fresh and merged key-wise, so every key the patch does not mention -- known or unknown -- survives the write.
    async updatePreferences(actor : SessionUser, patch : UpdatePreferencesRequest) : Promise<MeResponse>
    {
        const stored = await this.#users.preferencesOf(actor.id);
        await this.#users.setPreferences(actor.id, applyPreferencesPatch(stored, patch));

        return this.me(actor);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Create
    //------------------------------------------------------------------------------------------------------------------

    async createFolder(actor : SessionUser, request : CreateFolderRequest) : Promise<NodeResponse>
    {
        const parent = await this.#gatherParent(request.parentID);

        this.#enforce(await this.#judgeParentEdge(actor, parent));

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

        return toNodeResponse(node, { role: 'owner', sharing: NOTHING_SHARED });
    }

    async createLink(caller : Actor, request : CreateLinkRequest) : Promise<NodeResponse>
    {
        const target = await this.#nodes.get(request.targetNodeID);
        if(target === undefined) { throw new NotFoundError(`No target node ${ request.targetNodeID }.`); }

        const parent = await this.#gatherParent(request.parentID);
        const id = createId();

        const [ creatorRoleOnTarget, parentEdge ] = await Promise.all([
            this.#shares.effectiveRole(caller.user.id, target.id),
            this.#judgeParentEdge(caller.user, parent),
        ]);

        this.#enforce(regulation.combine([
            regulation.node.link({
                linkID: id,
                targetNodeID: target.id,
                targetType: target.type,
                creatorRoleOnTarget,
            }),
            parentEdge,
        ]));

        const now = new Date();
        // An unnamed link takes the target's current name at creation time.
        const node : Node = {
            type: 'link',
            id,
            name: request.name ?? target.name,
            ownerID: caller.user.id,
            parentID: request.parentID,
            targetNodeID: target.id,
            createdAt: now,
            updatedAt: now,
        };
        await this.#nodes.insert(node);

        return this.#respondNode(caller, node, 'owner');
    }

    //------------------------------------------------------------------------------------------------------------------
    // Copy
    //------------------------------------------------------------------------------------------------------------------

    // Save a copy: a new file node owned by the caller, referencing the SAME blob as the source (content-addressed
    // dedup -- zero bytes move), charged to the caller's quota at copy time and fully independent of the source
    // afterward. Gather the source as the caller sees it (read-as-absent -- a source they cannot resolve is a 404,
    // viewer suffices to copy); a trashed source reads as absent to everyone but its direct owner, mirroring the
    // download exemption -- the owner can already download trashed bytes and re-claim them, so blocking the direct
    // copy would only add friction. The copy lands live; the source stays trashed. Judge the source is a file and the
    // parent edge is legal for the caller (owning the parent or editor+ on it), then admit-and-insert charges quota
    // and lands the node.
    async copy(actor : SessionUser, nodeID : string, request : CopyNodeRequest) : Promise<NodeResponse>
    {
        const source = await this.#requireReadable(actor, nodeID);
        if(source.type !== 'link' && source.trashedAt !== null && !isDirectOwner(source, actor.id))
        {
            throw new NotFoundError(`No node ${ nodeID }.`);
        }

        const parent = await this.#gatherParent(request.parentID);

        this.#enforce(regulation.combine([
            regulation.node.copy({ source }),
            await this.#judgeParentEdge(actor, parent),
        ]));

        // Unreachable: judgeCopy rejects a non-file source above. The guard narrows the union so the snapshot reads the
        // file-only fields; a folder or link reaching here would mean the judge and this build disagree.
        if(source.type !== 'file')
        {
            throw new Error(`copy admitted a non-file source ${ source.id }`);
        }

        const snapshot : FileCopySnapshot = {
            name: request.name ?? source.name,
            mimeType: source.mimeType,
            size: source.size,
            blobID: source.blobID,
        };

        return this.#insertCopy(actor, snapshot, request.parentID);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Update
    //------------------------------------------------------------------------------------------------------------------

    // Rename and/or move, owner-only. Facts are gathered and judged before either write lands, so a rejected move never
    // leaves a half-applied rename behind.
    async patch(caller : Actor, id : string, patch : PatchNodeRequest) : Promise<NodeResponse>
    {
        const node = await this.#requireOwned(caller.user, id);

        if(patch.parentID !== undefined)
        {
            await this.#judgeMove(caller.user, node, patch.parentID);
        }

        if(patch.name !== undefined) { await this.#nodes.rename(id, patch.name); }
        if(patch.parentID !== undefined) { await this.#nodes.move(id, patch.parentID); }

        return this.#reread(caller, id);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Trash lifecycle
    //------------------------------------------------------------------------------------------------------------------

    async trash(caller : Actor, id : string) : Promise<NodeResponse>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        // judgeTrash owns both rules: links are deleted, never trashed (422), and only the owner may trash (403).
        this.#enforce(regulation.node.trash({ node, actorID: caller.user.id }));

        await this.#nodes.setTrashed(id, new Date());

        return this.#reread(caller, id);
    }

    async restore(caller : Actor, id : string) : Promise<NodeResponse>
    {
        const node = await this.#requireOwned(caller.user, id);

        // Restore returns the node where it was, unless its original parent is gone or still trashed -- then it lands
        // in the owner's root. setTrashed clears the whole subtree, so a restored folder brings its descendants back
        // with it.
        if(await this.#parentIsGoneOrTrashed(node))
        {
            await this.#nodes.move(id, null);
        }
        await this.#nodes.setTrashed(id, null);

        return this.#reread(caller, id);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Permanent delete
    //------------------------------------------------------------------------------------------------------------------

    async hardDelete(actor : SessionUser, id : string, options : { offerCopies ?: boolean } = {}) : Promise<void>
    {
        const node = await this.#requireOwned(actor, id);

        // A link carries no blob and roots no subtree: removing the row detaches it from the tree only, leaving the
        // target node and its share untouched. This is "remove from my drive".
        if(node.type === 'link')
        {
            await this.#nodes.hardDelete(id);
            return;
        }

        // The recipients-may-copy opt-in applies to a single file's delete; a folder delete ignores it (offering
        // per-file copies across a subtree is not modeled). Recipients and the snapshot are gathered BEFORE the
        // delete removes the rows the queries need. The offers commit atomically with the delete that justifies them
        // -- a crash cannot leave the file gone but its recipients uninvited -- so they ride the delete's transaction.
        const offers = options.offerCopies === true && node.type === 'file'
            ? await this.#mintableOffers(actor, node)
            : [];

        await this.#deleteSubtree(id, (trx) => this.#offers.insertMany(offers, trx));
    }

    // The trash-purge sweep's per-root exit: permanently delete one expired trashed subtree by its root, with NO actor
    // and NO ownership gate -- a system sweep answers to no user. It reuses the same subtree-delete + graveyard
    // transaction as hardDelete but mints NO deletion offers: an automatic purge is not an owner choosing "let
    // recipients save a copy," so recipients are never invited. The sweep hands only expired ROOTS
    // (NodeRA.expiredTrashRootIDs), so the parent_id cascade takes each subtree whole and no descendant is processed
    // twice.
    async purgeTrashedRoot(rootID : string) : Promise<void>
    {
        await this.#deleteSubtree(rootID);
    }

    // Empty the trash: permanently delete every root of the caller's own trashed subtrees, each through the exact
    // same subtree-delete + blob-graveyard path a single hardDelete purge takes -- purgeTrashedRoot per root, not a
    // bulk delete, so the two can never drift apart. NodeRA.trashedRootIDs is already owner-scoped, so another
    // user's trash is untouched without a further ownership gate here. An empty trash purges nothing and reports 0.
    async emptyTrash(actor : SessionUser) : Promise<EmptyTrashResponse>
    {
        const roots = await this.#nodes.trashedRootIDs(actor.id);

        await Promise.all(roots.map((rootID) => this.purgeTrashedRoot(rootID)));

        return { purged: roots.length };
    }

    // One offer per user who can currently see the file through a share -- a grant on the file itself or on any
    // ancestor folder. The owner is excluded (they are the deleter), and the expiry is the blob's GC grace deadline:
    // the graveyard keeps the bytes exactly that long, so an unexpired offer is always materializable.
    async #mintableOffers(actor : SessionUser, node : FileNode) : Promise<DeletionOffer[]>
    {
        const chain = [ node.id, ...await this.#nodes.ancestorIDs(node.id) ];
        const granteeIDs = await this.#shares.granteeIDsFor(chain);

        const now = new Date();
        const expiresAt = new Date(now.getTime() + await this.#offerGraceMs());

        return granteeIDs
            .filter((granteeID) => granteeID !== node.ownerID)
            .map((granteeID) => ({
                id: createId(),
                sha256: node.blobID,
                offereeID: granteeID,
                name: node.name,
                mimeType: node.mimeType,
                size: node.size,
                createdBy: actor.id,
                createdAt: now,
                expiresAt,
            }));
    }

    // The ownerless core of a permanent delete, shared by the owner-gated hardDelete and the system trash-purge sweep.
    // Collect the subtree's blob shas BEFORE the delete removes the rows (read-only), then delete the subtree and hand
    // the shas to the graveyard in ONE transaction: a crash between them would strand the now-unreferenced blobs (row
    // gone, no graveyard marker, GC blind to them). graveyardUnreferenced re-derives each blob's reference count
    // against the post-delete rows, so a sha still referenced elsewhere stays live. The delete cascades the whole
    // subtree and every link pointing into it. The optional `within` hook runs inside the same transaction for a
    // caller that must commit related rows atomically with the delete (hardDelete mints deletion offers there); the
    // sweep passes none.
    async #deleteSubtree(id : string, within ?: (trx : DatabaseHandle['db']) => Promise<void>) : Promise<void>
    {
        const shas = await this.#nodes.subtreeFileBlobIDs(id);

        await this.#db.transaction().execute(async (trx) =>
        {
            await this.#nodes.hardDelete(id, trx);
            await this.#orphanedBlobs.graveyardUnreferenced(shas, trx);
            if(within !== undefined) { await within(trx); }
        });
    }

    //------------------------------------------------------------------------------------------------------------------
    // Broken-link cleanup
    //------------------------------------------------------------------------------------------------------------------

    // Purge the caller's dead links inside a folder. Authority is read access to the folder: one the caller cannot
    // resolve reads as absent (404), and nothing below touches a node they do not own, so read access is enough --
    // the purge only ever prunes the caller's own placements, never a contributor's links in a shared folder.
    //
    // "Dead" is derived here at purge time, never a stored flag: the same target resolution the listings use keeps a
    // target only if it exists AND the caller resolves a non-null role on it, so a link whose target is absent from
    // that set is dead FOR THE CALLER -- its share was revoked, or the target moved beyond their reach. A live link
    // (target still resolvable) survives, so a transient revocation that later heals never loses the placement.
    async purgeBrokenLinks(actor : SessionUser, folderID : string) : Promise<PurgeBrokenLinksResponse>
    {
        await this.#requireReadable(actor, folderID);

        const links = await this.#nodes.linkChildrenOwnedBy(folderID, actor.id);
        const resolved = await this.#resolveTargets(actor, links);
        const deadIDs = links
            .filter((link) => !resolved.has(link.targetNodeID))
            .map((link) => link.id);

        await this.#nodes.hardDeleteMany(deadIDs);

        return { purged: deadIDs.length };
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

    async #judgeParentEdge(actor : SessionUser, parent : Node | null) : Promise<RegulationResult>
    {
        return regulation.node.parentEdge({
            creatorID: actor.id,
            parent,
            creatorRoleOnParent: parent === null ? null : await this.#shares.effectiveRole(actor.id, parent.id),
        });
    }

    async #judgeMove(actor : SessionUser, node : Node, newParentID : string | null) : Promise<void>
    {
        const parent = await this.#gatherParent(newParentID);
        const parentAncestorIDs = newParentID === null ? [] : await this.#nodes.ancestorIDs(newParentID);

        this.#enforce(regulation.combine([
            regulation.node.move({ nodeID: node.id, newParentID, parentAncestorIDs }),
            await this.#judgeParentEdge(actor, parent),
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
    // Authority here is DIRECT ownership, never the resolver's 'owner' role, which an ancestor owner also earns --
    // a folder owner may read a contribution placed in their folder but does not administer it.
    async #requireOwned(actor : SessionUser, id : string) : Promise<Node>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }
        if(!isDirectOwner(node, actor.id)) { throw new ForbiddenError('Only the owner may modify this node.'); }

        return node;
    }

    // Fetch a node the caller may read: any resolvable role (viewer suffices). A missing node or one the caller cannot
    // resolve reads as absent -- a 404 that never confirms the node exists -- the same read-as-absent doctrine `get`
    // applies. Unlike `#requireOwned`, this is access, not authority: a viewer of a shared file resolves it here.
    async #requireReadable(actor : SessionUser, id : string) : Promise<Node>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        const role = await this.#shares.effectiveRole(actor.id, node.id);
        if(role === null) { throw new NotFoundError(`No node ${ id }.`); }

        return node;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Quota admission & copy insertion
    //------------------------------------------------------------------------------------------------------------------

    // The deletion-offer accept path: the same admit-and-insert a copy runs, but from a stored snapshot with no live
    // source node, so only the parent edge needs judging here. `prepare` runs inside the insert transaction --
    // the caller consumes its offer row and resurrects the blob atomically with the node that references them.
    async materializeSnapshot(
        actor : SessionUser,
        snapshot : FileCopySnapshot,
        parentID : string | null,
        prepare ?: (trx : DatabaseHandle['db']) => Promise<void>
    ) : Promise<NodeResponse>
    {
        const parent = await this.#gatherParent(parentID);
        this.#enforce(await this.#judgeParentEdge(actor, parent));

        return this.#insertCopy(actor, snapshot, parentID, prepare);
    }

    // Land a copy as a fresh file node owned by the caller. An early quota gate rejects before a write is opened, then
    // the insert re-judges quota against usage read INSIDE the transaction: the early gate admits each copy in
    // isolation, so a batch of concurrent copies could jointly overshoot; the in-transaction re-check is the
    // authoritative one (it fully closes the window on SQLite's serialized writes, and narrows it on Postgres). The
    // copy path needs no blob write -- the live source keeps the blob referenced; the accept path's resurrection
    // arrives through `prepare`, inside the same transaction, and a quota rejection rolls it back offer and all.
    async #insertCopy(
        actor : SessionUser,
        snapshot : FileCopySnapshot,
        parentID : string | null,
        prepare ?: (trx : DatabaseHandle['db']) => Promise<void>
    ) : Promise<NodeResponse>
    {
        const limitBytes = await this.#resolveLimit(actor.id);
        this.#enforceQuota(actor.id, await this.#nodes.ownedBytes(actor.id), snapshot.size, limitBytes);

        const now = new Date();
        const node : FileNode = {
            type: 'file',
            id: createId(),
            name: snapshot.name,
            ownerID: actor.id,
            parentID,
            blobID: snapshot.blobID,
            size: snapshot.size,
            mimeType: snapshot.mimeType,
            createdAt: now,
            updatedAt: now,
            trashedAt: null,
        };

        await this.#db.transaction().execute(async (trx) =>
        {
            if(prepare !== undefined) { await prepare(trx); }

            const nodes = new NodeRA({ db: trx, kind: this.#kind });
            this.#enforceQuota(actor.id, await nodes.ownedBytes(actor.id), snapshot.size, limitBytes);
            await nodes.insert(node);
        });

        return toNodeResponse(node, { role: 'owner', sharing: NOTHING_SHARED });
    }

    // The cap an owner is held to right now: their quota_limit read from their user row, with the instance default
    // folded in. Both halves are read live, never taken from the actor's session -- the session cookie cache carries
    // a snapshot of the user row for its whole window, so enforcing against it would judge a write by a limit an
    // admin has already replaced.
    //
    // Always called BEFORE a transaction opens: it reads the user row and the settings row, and SQLite serializes
    // writes, so a read issued from inside an open write transaction on the same handle deadlocks the commit. The
    // resolved limit is then carried into the transaction as a plain number.
    async #resolveLimit(ownerID : string) : Promise<number | null>
    {
        const [ userLimit, instanceDefault ] = await Promise.all([
            this.#users.quotaLimitOf(ownerID),
            this.#defaultQuota(),
        ]);

        return effectiveQuota(userLimit, instanceDefault);
    }

    #enforceQuota(ownerID : string, usedBytes : number, incomingBytes : number, limitBytes : number | null) : void
    {
        const verdict = regulation.quota.admit({
            ownerID,
            usedBytes,
            limitBytes,
            incomingBytes,
        });

        if(!verdict.ok)
        {
            throw new ForbiddenError(verdict.violations[0]?.message ?? 'This write would exceed the storage quota.');
        }
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
    async #reread(caller : Actor, id : string) : Promise<NodeResponse>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        return this.#respondNode(caller, node, 'owner');
    }

    // Resolve a page of nodes' link targets in one round trip. A target the viewer cannot resolve -- the row is gone,
    // or access was lost -- is simply absent from the map, so the link serializes with a null target and renders as a
    // stub.
    async #resolveTargets(actor : SessionUser, page : readonly Node[]) : Promise<Map<string, Node>>
    {
        const targetIDs = new Set<string>();
        for(const node of page)
        {
            if(node.type === 'link') { targetIDs.add(node.targetNodeID); }
        }

        const targets = await this.#nodes.getMany([ ...targetIDs ]);
        const roles = await this.#shares.effectiveRoles(actor.id, targets.map((target) => target.id));

        const resolved = new Map<string, Node>();
        for(const target of targets)
        {
            if((roles.get(target.id) ?? null) !== null) { resolved.set(target.id, target); }
        }

        return resolved;
    }

    // The distinct owners of a result page, batched through the same summary lookup the folder listing's owner facet
    // and the share/grant surfaces use. A page never carries an ownerID summariesByIDs can't resolve -- ownership is a
    // real FK to user.id -- so this is a straight lookup, not a filtered one. Resolved link targets on the page widen
    // the id collection BEFORE that one lookup runs: a link attributes to its target's owner, not its own, so the
    // owner-filter facet must offer that owner too -- still one round trip, never a query per link.
    async #ownersOfPage(page : readonly Node[], targets : ReadonlyMap<string, Node>) : Promise<UserSummary[]>
    {
        const ownerIDs = new Set(page.map((node) => node.ownerID));
        for(const target of targets.values()) { ownerIDs.add(target.ownerID); }

        const ids = [ ...ownerIDs ];
        const summaries = await this.#users.summariesByIDs(ids);

        return ids
            .map((id) => summaries.get(id))
            .filter((summary) : summary is UserSummary => summary !== undefined);
    }

    // The folder's owner facet (whole-folder, from NodeRA.ownersOf), widened with the owners of resolved link
    // targets on THIS PAGE -- a link attributes to its target's owner, so the filter menu must offer that owner too.
    // Folder-wide link resolution is not attempted here (the facet stays whole-folder for direct ownership, page-
    // scoped for link targets, matching how targets themselves are only resolved for the page). `extraOwnerID` folds
    // in the owner of a folder link the listing was reached THROUGH, so its crumb hover has the summary in hand. One
    // batched lookup covers every missing owner; an owner already in the folder facet costs nothing extra. Sorted by
    // name to preserve the facet's stable-menu ordering after the merge.
    async #withTargetOwners(
        base : readonly UserSummary[],
        targets : ReadonlyMap<string, Node>,
        extraOwnerID ?: string
    ) : Promise<UserSummary[]>
    {
        const knownIDs = new Set(base.map((owner) => owner.id));
        const candidateIDs = [ ...targets.values() ].map((target) => target.ownerID);
        if(extraOwnerID !== undefined) { candidateIDs.push(extraOwnerID); }
        const missingIDs = [ ...new Set(candidateIDs.filter((id) => !knownIDs.has(id))) ];

        if(missingIDs.length === 0) { return [ ...base ]; }

        const summaries = await this.#users.summariesByIDs(missingIDs);
        const extra = missingIDs
            .map((id) => summaries.get(id))
            .filter((summary) : summary is UserSummary => summary !== undefined);

        return [ ...base, ...extra ].sort((left, right) => left.name.localeCompare(right.name));
    }

    // The single-node answer, for a read or for an endpoint reporting what it just changed. Sharing is looked up rather
    // than assumed: the client writes these responses straight back into the row it changed, so a null would blank a
    // badge the file still earns. A link costs nothing to ask about -- one never carries sharing of its own.
    async #respondNode(caller : Actor, node : Node, role : Role) : Promise<NodeResponse>
    {
        const sharing = (await this.#sharingOf(caller, [ node ])).get(node.id) ?? null;
        if(node.type !== 'link') { return toNodeResponse(node, { role, sharing }); }

        const target = await this.#nodes.get(node.targetNodeID);
        const targetRole = target === undefined ? null : await this.#shares.effectiveRole(caller.user.id, target.id);
        const resolved = target !== undefined && targetRole !== null ? target : null;

        return toNodeResponse(node, { role, sharing, target: resolved });
    }
}

//----------------------------------------------------------------------------------------------------------------------
