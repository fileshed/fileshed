//----------------------------------------------------------------------------------------------------------------------
// Node Manager
//
// Every mutation gathers the facts a judgement needs, runs the regulation engine, then acts, so cross-record legality
// (parent-edge ownership, link-to-link, move cycles, trash rules) is decided in one pure place.
//
// A caller's effective role on a node always comes from the share RA's resolver -- max(ownership, direct grant,
// inherited grant) over the node's real ancestor chain. Links never conduct permission: a link's target resolves
// against the viewer's own access.
//----------------------------------------------------------------------------------------------------------------------

import { createId } from '@paralleldrive/cuid2';

// Models
import {
    type ChildrenQuery,
    type CopyNodeRequest,
    type CreateFolderRequest,
    type CreateLinkRequest,
    DEFAULT_GC_GRACE_DAYS,
    type DeletionOffer,
    type EmptyTrashResponse,
    type FileNode,
    ForbiddenError,
    type ListingQuery,
    MS_PER_DAY,
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
    type UserSummary,
    isDirectOwner,
    isHiddenTrash,
    maxRole,
    permissionDemands,
    publicLinkPath,
    statementSatisfies,
    toNodeResponse,
} from '@fileshed/core';

// Engines
import { resolveLocation } from '../engines/location.ts';
import { type RegulationResult, regulation } from '../engines/regulation/index.ts';

// Managers
import { NodeAdmission } from './nodeAdmission.ts';
import type { Actor } from './session.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth/instance.ts';
import { type DatabaseHandle, inTransaction } from '../resource-access/database/database.ts';
import { DeletionOfferRA } from '../resource-access/deletionOffers/index.ts';
import {
    type AccessScope,
    type ChildrenOptions,
    type ListingRoot,
    type NodeFilters,
    NodeRA,
} from '../resource-access/nodes/index.ts';
import { PublicLinkRA } from '../resource-access/publicLinks/index.ts';
import { ShareRA } from '../resource-access/shares/index.ts';
import { UserRA } from '../resource-access/users/index.ts';

//----------------------------------------------------------------------------------------------------------------------

// Blob graveyarding: after a subtree is hard-deleted, the shas of its files' blobs are handed here so the
// now-unreferenced ones can be graveyarded. The upload/GC side owns the implementation; the node manager only reports
// which blobs a delete may have orphaned. Passing an already-referenced sha is safe -- the handler re-derives the
// reference count and leaves live blobs alone.
export interface OrphanedBlobs
{
    graveyardUnreferenced(shas : string[]) : Promise<void>;
}

// Built over the delete's own transaction, so the graveyard marks commit or roll back with the rows that orphaned them.
export type OrphanedBlobsFor = (tx : DatabaseHandle) => OrphanedBlobs;

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

// GET /nodes/:id/links and GET /nodes/:id/shares already demand. A link URL is not a description of the capability,
// it IS the capability, so a files:read key must never harvest one off a listing it may otherwise read.
function maySeeSharing(actor : Actor) : boolean
{
    return actor.kind === 'session' || statementSatisfies(actor.permissions, permissionDemands.sharesRead);
}

// The tunables the manager reads rather than remembers: each is a supplier called at use time, so an admin moving one
// applies to the very next request instead of the next restart. An omitted supplier answers the shipped default --
// except defaultQuota, which every composition must state, because guessing it wrong fails open on storage.
export interface NodePolicy
{
    offerGraceMs ?: () => Promise<number>;
    defaultQuota : () => Promise<number>;
}

export interface NodeManagerDeps
{
    handle : DatabaseHandle;
    orphanedBlobs : OrphanedBlobsFor;
    policy : NodePolicy;
}

export class NodeManager
{
    readonly #handle : DatabaseHandle;
    readonly #nodes : NodeRA;
    readonly #shares : ShareRA;
    readonly #admission : NodeAdmission;
    readonly #links : PublicLinkRA;
    readonly #users : UserRA;
    readonly #orphanedBlobs : OrphanedBlobsFor;
    readonly #offerGraceMs : () => Promise<number>;

    constructor(deps : NodeManagerDeps)
    {
        const { handle, policy } = deps;

        this.#handle = handle;
        this.#nodes = new NodeRA(handle);
        this.#shares = new ShareRA(handle);
        this.#links = new PublicLinkRA(handle);
        this.#users = new UserRA(handle);
        this.#orphanedBlobs = deps.orphanedBlobs;
        this.#offerGraceMs = policy.offerGraceMs ?? (async () => DEFAULT_GC_GRACE_DAYS * MS_PER_DAY);
        this.#admission = new NodeAdmission({
            nodes: this.#nodes,
            shares: this.#shares,
            users: this.#users,
            defaultQuota: policy.defaultQuota,
        });
    }

    //------------------------------------------------------------------------------------------------------------------
    // Reads
    //------------------------------------------------------------------------------------------------------------------

    async get(actor : Actor, id : string) : Promise<NodeResponse>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        const role = await this.#shares.effectiveRole(actor.user.id, node.id);

        // A read of a node the caller has no access to reads as absent -- a 404 that never confirms the node exists. A
        // viewer or editor resolves to a non-null role and reads it. A trashed node is likewise absent to everyone but
        // its direct owner: the resolver deliberately ignores trash state (a pure ancestor walk), so this guard is
        // where recipients lose sight of trashed items -- the same doctrine download and copy apply.
        if(role === null) { throw new NotFoundError(`No node ${ id }.`); }
        if(isHiddenTrash(node, actor.user.id))
        {
            throw new NotFoundError(`No node ${ id }.`);
        }

        return this.respond(actor, node, role);
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
    async children(actor : Actor, parentID : string | null, query : ChildrenQuery) : Promise<NodeListResponse>
    {
        const user = actor.user;

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

            parentRole = await this.#shares.effectiveRole(user.id, listedParent.id);
            if(parentRole === null) { throw new NotFoundError(`No node ${ parentID }.`); }

            // The owner keeps listing a trashed folder: that is the trash view.
            if(isHiddenTrash(listedParent, user.id))
            {
                throw new NotFoundError(`No node ${ parentID }.`);
            }

            listedParentID = listedParent.id;
            if(parent.type === 'link') { traversedTargetOwnerID = listedParent.ownerID; }
        }

        // ownerID scopes the ROOT listing only -- that is where per-user trees begin. A folder's listing is scoped by
        // the folder alone (NodeRA.children), which is what lets contributions by other owners appear.
        const listing : ListingRoot = { parentID: listedParentID, ownerID: user.id };
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
            this.#shares.directGrants(user.id, page.map((node) => node.id)),
            this.#resolveTargets(user, page),
            this.#sharingOf(actor, page),
        ]);

        const roleFor = (node : Node) : Role =>
        {
            const ownership : Role | null = isDirectOwner(node, user.id) ? 'owner' : null;
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

    // Name search over the nodes the caller can see. The candidate query is SCOPED to their reach rather than filtered
    // down to it: the RA descends from the caller's access roots (what they own, what is granted to them) and matches
    // names inside that set, so the candidate cap cuts their own matches and a stranger's names can neither surface
    // nor crowd them out. `total` is therefore the count of everything they may reach, and the page slices it.
    //
    // Roles resolve for the PAGE alone. Every candidate is reachable by construction, so a resolve over all of them
    // would only re-derive what the scope already established -- at one recursive ancestor walk per candidate. Each
    // hit also carries where it lives, trimmed to the part of its ancestry the caller may see.
    async search(actor : Actor, query : SearchQuery) : Promise<SearchResponse>
    {
        const user = actor.user;
        const scope : AccessScope = {
            userID: user.id,
            grantedNodeIDs: await this.#shares.grantedNodeIDs(user.id),
        };
        const accessible = await this.#nodes.searchByName(query.q, scope, SEARCH_CANDIDATE_LIMIT);

        const page = accessible.slice(query.offset, query.offset + query.limit);
        const roles = await this.#shares.effectiveRoles(user.id, page.map((node) => node.id));
        const targets = await this.#resolveTargets(user, page);
        const owners = await this.#ownersOfPage(page, targets);
        const [ locations, sharing ] = await Promise.all([
            this.#locationsOf(user, page),
            this.#sharingOf(actor, page),
        ]);

        const nodes = page.map((node) =>
        {
            const role = roles.get(node.id) ?? null;

            // Unreachable: the scope and the resolver decide reachability by the same rule, bounded by the same walk
            // depth. A null here means those two disagree, so refuse loudly rather than stamp a role the resolver
            // never granted.
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
    async #sharingOf(actor : Actor, page : readonly Node[]) : Promise<Map<string, NodeSharing>>
    {
        const sharing = new Map<string, NodeSharing>();
        if(!maySeeSharing(actor)) { return sharing; }

        const liveIDs : string[] = [];
        for(const node of page)
        {
            if(isDirectOwner(node, actor.user.id) && node.type !== 'link')
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
    async #locationsOf(user : SessionUser, page : readonly Node[]) : Promise<Record<string, NodeLocation>>
    {
        if(page.length === 0) { return {}; }

        const chains = await this.#nodes.ancestorChains(page.map((node) => node.id));

        const ancestorIDs = new Set<string>();
        for(const chain of chains.values())
        {
            for(const ancestor of chain) { ancestorIDs.add(ancestor.id); }
        }

        const roles = await this.#shares.effectiveRoles(user.id, [ ...ancestorIDs ]);
        const visibleIDs = new Set([ ...ancestorIDs ].filter((id) => (roles.get(id) ?? null) !== null));

        const locations : Record<string, NodeLocation> = {};
        for(const node of page)
        {
            locations[node.id] = resolveLocation({
                ownerID: node.ownerID,
                parentID: node.parentID,
                ancestors: chains.get(node.id) ?? [],
                visibleIDs,
                actorID: user.id,
            });
        }

        return locations;
    }

    // The caller's Trash view: the roots of their own trashed subtrees, paged and sorted like a folder listing. Every
    // node here is directly owned by the caller, so each carries the 'owner' role; roots-only, so a trashed folder
    // lists once and its descendants ride along rather than appearing on their own. An owner facet would name only the
    // caller themselves, so it carries none.
    async listTrash(user : SessionUser, query : ListingQuery) : Promise<NodeListResponse>
    {
        const options : ChildrenOptions = {
            pagination: { limit: query.limit, offset: query.offset },
            sort: { key: query.sortKey, direction: query.sortDirection },
        };

        // The filters ride the ROOT predicate, so roots-only holds -- a filter narrows which trashed roots list, never
        // reaching into the descendants riding along under a trashed folder.
        const filters : NodeFilters = {
            types: query.types,
            updatedAfter: query.updatedAfter === undefined ? undefined : new Date(query.updatedAfter),
            updatedBefore: query.updatedBefore === undefined ? undefined : new Date(query.updatedBefore),
        };

        const [ page, total ] = await Promise.all([
            this.#nodes.trashedRoots(user.id, options, filters),
            this.#nodes.countTrashedRoots(user.id, filters),
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

    //------------------------------------------------------------------------------------------------------------------
    // Create
    //------------------------------------------------------------------------------------------------------------------

    async createFolder(user : SessionUser, request : CreateFolderRequest) : Promise<NodeResponse>
    {
        const parent = await this.#admission.gatherParent(request.parentID);

        this.#enforce(await this.#admission.judgePlacement(user.id, parent));

        const now = new Date();
        const node : Node = {
            type: 'folder',
            id: createId(),
            name: request.name,
            ownerID: user.id,
            parentID: request.parentID,
            createdAt: now,
            updatedAt: now,
            trashedAt: null,
        };
        await this.#nodes.insert(node);

        return toNodeResponse(node, { role: 'owner', sharing: NOTHING_SHARED });
    }

    async createLink(actor : Actor, request : CreateLinkRequest) : Promise<NodeResponse>
    {
        const target = await this.#nodes.get(request.targetNodeID);
        if(target === undefined) { throw new NotFoundError(`No target node ${ request.targetNodeID }.`); }

        const parent = await this.#admission.gatherParent(request.parentID);
        const id = createId();

        const [ creatorRoleOnTarget, placement ] = await Promise.all([
            this.#shares.effectiveRole(actor.user.id, target.id),
            this.#admission.judgePlacement(actor.user.id, parent),
        ]);

        this.#enforce(regulation.combine([
            regulation.node.link({
                targetNodeID: target.id,
                targetType: target.type,
                creatorRoleOnTarget,
            }),
            placement,
        ]));

        const now = new Date();
        // An unnamed link takes the target's current name at creation time.
        const node : Node = {
            type: 'link',
            id,
            name: request.name ?? target.name,
            ownerID: actor.user.id,
            parentID: request.parentID,
            targetNodeID: target.id,
            createdAt: now,
            updatedAt: now,
        };
        await this.#nodes.insert(node);

        return this.respond(actor, node, 'owner');
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
    async copy(user : SessionUser, nodeID : string, request : CopyNodeRequest) : Promise<NodeResponse>
    {
        const source = await this.#requireReadable(user, nodeID);
        if(isHiddenTrash(source, user.id))
        {
            throw new NotFoundError(`No node ${ nodeID }.`);
        }

        const parent = await this.#admission.gatherParent(request.parentID);

        this.#enforce(regulation.combine([
            regulation.node.copy({ source }),
            await this.#admission.judgePlacement(user.id, parent),
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

        return this.#insertCopy(user, snapshot, request.parentID);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Update
    //------------------------------------------------------------------------------------------------------------------

    // Rename and/or move, owner-only. Facts are gathered and judged before either write lands, so a rejected move never
    // leaves a half-applied rename behind.
    async patch(actor : Actor, id : string, patch : PatchNodeRequest) : Promise<NodeResponse>
    {
        const node = await this.#requireOwned(actor.user, id);

        if(patch.parentID !== undefined)
        {
            await this.#judgeMove(actor.user, node, patch.parentID);
        }

        if(patch.name !== undefined) { await this.#nodes.rename(id, patch.name); }
        if(patch.parentID !== undefined) { await this.#nodes.move(id, patch.parentID); }

        return this.#reread(actor, id);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Trash lifecycle
    //------------------------------------------------------------------------------------------------------------------

    async trash(actor : Actor, id : string) : Promise<NodeResponse>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        // judgeTrash owns both rules: links are deleted, never trashed (422), and only the owner may trash (403).
        this.#enforce(regulation.node.trash({ node, actorID: actor.user.id }));

        await this.#nodes.setTrashed(id, new Date());

        return this.#reread(actor, id);
    }

    async restore(actor : Actor, id : string) : Promise<NodeResponse>
    {
        const node = await this.#requireOwned(actor.user, id);

        // Restore returns the node where it was, unless its original parent is gone or still trashed -- then it lands
        // in the owner's root. setTrashed clears the whole subtree, so a restored folder brings its descendants back
        // with it.
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

    async hardDelete(user : SessionUser, id : string, options : { offerCopies ?: boolean } = {}) : Promise<void>
    {
        const node = await this.#requireOwned(user, id);

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
            ? await this.#mintableOffers(user, node)
            : [];

        await this.#deleteSubtree(id, (tx) => new DeletionOfferRA(tx).insertMany(offers));
    }

    // The system exit from the tree: permanently delete one subtree by its root, with NO actor and NO ownership gate
    // -- a sweep, or an account being deleted, answers to no user. It reuses the same subtree-delete + graveyard
    // transaction as hardDelete but mints NO deletion offers: neither an automatic purge nor a closing account is an
    // owner choosing "let recipients save a copy," so recipients are never invited. Every caller hands ROOTS only --
    // roots of expired trash, of a departing owner's holdings -- so the parent_id cascade takes each subtree whole
    // and no descendant is processed twice.
    async purgeSubtree(rootID : string) : Promise<void>
    {
        await this.#deleteSubtree(rootID);
    }

    // Empty the trash: permanently delete every root of the caller's own trashed subtrees, each through the exact
    // same subtree-delete + blob-graveyard path a single hardDelete purge takes -- purgeSubtree per root, not a
    // bulk delete, so the two can never drift apart. NodeRA.trashedRootIDs is already owner-scoped, so another
    // user's trash is untouched without a further ownership gate here. An empty trash purges nothing and reports 0.
    async emptyTrash(user : SessionUser) : Promise<EmptyTrashResponse>
    {
        const roots = await this.#nodes.trashedRootIDs(user.id);

        await Promise.all(roots.map((rootID) => this.purgeSubtree(rootID)));

        return { purged: roots.length };
    }

    // One offer per user who can currently see the file through a share -- a grant on the file itself or on any
    // ancestor folder. The owner is excluded (they are the deleter), and the expiry is the blob's GC grace deadline:
    // the graveyard keeps the bytes exactly that long, so an unexpired offer is always materializable.
    async #mintableOffers(user : SessionUser, node : FileNode) : Promise<DeletionOffer[]>
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
                createdBy: user.id,
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
    async #deleteSubtree(id : string, within ?: (tx : DatabaseHandle) => Promise<void>) : Promise<void>
    {
        const shas = await this.#nodes.subtreeFileBlobIDs(id);

        await inTransaction(this.#handle, async (tx) =>
        {
            await new NodeRA(tx).hardDelete(id);
            await this.#orphanedBlobs(tx).graveyardUnreferenced(shas);
            if(within !== undefined) { await within(tx); }
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
    async purgeBrokenLinks(user : SessionUser, folderID : string) : Promise<PurgeBrokenLinksResponse>
    {
        await this.#requireReadable(user, folderID);

        const links = await this.#nodes.linkChildrenOwnedBy(folderID, user.id);
        const resolved = await this.#resolveTargets(user, links);
        const deadIDs = links
            .filter((link) => !resolved.has(link.targetNodeID))
            .map((link) => link.id);

        await this.#nodes.hardDeleteMany(deadIDs);

        return { purged: deadIDs.length };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Fact gathering & judgement
    //------------------------------------------------------------------------------------------------------------------

    async #judgeMove(user : SessionUser, node : Node, newParentID : string | null) : Promise<void>
    {
        const parent = await this.#admission.gatherParent(newParentID);
        const [ parentAncestorIDs, placedHeight ] = await Promise.all([
            newParentID === null ? Promise.resolve([]) : this.#nodes.ancestorIDs(newParentID),
            this.#nodes.subtreeHeight(node.id),
        ]);

        this.#enforce(regulation.combine([
            regulation.node.move({ nodeID: node.id, newParentID, parentAncestorIDs }),
            await this.#admission.judgePlacement(user.id, parent, placedHeight, parentAncestorIDs),
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
    async #requireOwned(user : SessionUser, id : string) : Promise<Node>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }
        if(!isDirectOwner(node, user.id)) { throw new ForbiddenError('Only the owner may modify this node.'); }

        return node;
    }

    // Fetch a node the caller may read: any resolvable role (viewer suffices). A missing node or one the caller cannot
    // resolve reads as absent -- a 404 that never confirms the node exists -- the same read-as-absent doctrine `get`
    // applies. Unlike `#requireOwned`, this is access, not authority: a viewer of a shared file resolves it here.
    async #requireReadable(user : SessionUser, id : string) : Promise<Node>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        const role = await this.#shares.effectiveRole(user.id, node.id);
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
        user : SessionUser,
        snapshot : FileCopySnapshot,
        parentID : string | null,
        prepare ?: (tx : DatabaseHandle) => Promise<void>
    ) : Promise<NodeResponse>
    {
        const parent = await this.#admission.gatherParent(parentID);
        this.#enforce(await this.#admission.judgePlacement(user.id, parent));

        return this.#insertCopy(user, snapshot, parentID, prepare);
    }

    // Land a copy as a fresh file node owned by the caller. An early quota gate rejects before a write is opened, then
    // the insert re-judges quota against usage read INSIDE the transaction: the early gate admits each copy in
    // isolation, so a batch of concurrent copies could jointly overshoot; the in-transaction re-check is the
    // authoritative one (it fully closes the window on SQLite's serialized writes, and narrows it on Postgres). The
    // copy path needs no blob write -- the live source keeps the blob referenced; the accept path's resurrection
    // arrives through `prepare`, inside the same transaction, and a quota rejection rolls it back offer and all.
    async #insertCopy(
        user : SessionUser,
        snapshot : FileCopySnapshot,
        parentID : string | null,
        prepare ?: (tx : DatabaseHandle) => Promise<void>
    ) : Promise<NodeResponse>
    {
        const limitBytes = await this.#admission.resolveLimit(user.id);
        this.#admission.enforceQuota(user.id, await this.#nodes.ownedBytes(user.id), snapshot.size, limitBytes);

        const now = new Date();
        const node : FileNode = {
            type: 'file',
            id: createId(),
            name: snapshot.name,
            ownerID: user.id,
            parentID,
            blobID: snapshot.blobID,
            size: snapshot.size,
            mimeType: snapshot.mimeType,
            createdAt: now,
            updatedAt: now,
            trashedAt: null,
        };

        await inTransaction(this.#handle, async (tx) =>
        {
            if(prepare !== undefined) { await prepare(tx); }

            const nodes = new NodeRA(tx);
            this.#admission.enforceQuota(user.id, await nodes.ownedBytes(user.id), snapshot.size, limitBytes);
            await nodes.insert(node);
        });

        return toNodeResponse(node, { role: 'owner', sharing: NOTHING_SHARED });
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
    async #reread(actor : Actor, id : string) : Promise<NodeResponse>
    {
        const node = await this.#nodes.get(id);
        if(node === undefined) { throw new NotFoundError(`No node ${ id }.`); }

        return this.respond(actor, node, 'owner');
    }

    // Resolve a page of nodes' link targets in one round trip. A target the viewer cannot resolve -- the row is gone,
    // or access was lost -- is simply absent from the map, so the link serializes with a null target and renders as a
    // stub.
    async #resolveTargets(user : SessionUser, page : readonly Node[]) : Promise<Map<string, Node>>
    {
        const targetIDs = new Set<string>();
        for(const node of page)
        {
            if(node.type === 'link') { targetIDs.add(node.targetNodeID); }
        }

        const targets = await this.#nodes.getMany([ ...targetIDs ]);
        const roles = await this.#shares.effectiveRoles(user.id, targets.map((target) => target.id));

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
    async respond(actor : Actor, node : Node, role : Role) : Promise<NodeResponse>
    {
        const sharing = (await this.#sharingOf(actor, [ node ])).get(node.id) ?? null;
        if(node.type !== 'link') { return toNodeResponse(node, { role, sharing }); }

        const target = await this.#nodes.get(node.targetNodeID);
        const targetRole = target === undefined ? null : await this.#shares.effectiveRole(actor.user.id, target.id);
        const resolved = target !== undefined && targetRole !== null ? target : null;

        return toNodeResponse(node, { role, sharing, target: resolved });
    }
}

//----------------------------------------------------------------------------------------------------------------------
