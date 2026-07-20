//----------------------------------------------------------------------------------------------------------------------
// Share Manager
//
// The share and share-request lifecycle: grant, revoke, and leave; the owner's grant list and the recipient's Shared
// with me; and access requests -- ask, list, grant, decline. Every mutation follows the same shape: gather the facts a
// judgement needs, run the regulation engine, then act. Grant legality (owner-only, no link, no self-grant) and
// request-resolution legality (target-owner-only, pending-only) are decided in the pure engine and turned into a typed
// RegulationError here; all I/O goes through the node and share RAs.
//
// One granting path serves both a direct grant and the grant that resolves a request, so "editors can re-share" (a
// future toggle) has a single place to relax. Re-granting an existing grantee updates their role rather than
// conflicting -- the share dialog's role select is the same operation as a first grant.
//
// Access requests are for people with NO access: they are scoped to a user who can see an item exists but cannot
// resolve it. A user who already holds any role is refused, so requestedRole names the level you are asking for as an
// outsider, not an upgrade a viewer can request. Upgrade requests are post-v1; until then the owner changes a role
// directly through the share dialog.
//----------------------------------------------------------------------------------------------------------------------

import { createId } from '@paralleldrive/cuid2';

// Models
import {
    type AccessRequestListResponse,
    type AccessRequestResponse,
    BadRequestError,
    type CreateAccessRequest,
    ForbiddenError,
    type GrantShareRequest,
    type Node,
    NotFoundError,
    type PendingShareRequest,
    RegulationError,
    type Share,
    type ShareListResponse,
    type ShareRequest,
    type ShareResponse,
    type ShareRole,
    type SharedWithMeResponse,
    isDirectOwner,
    toAccessRequestResponse,
    toShareResponse,
} from '@fileshed/core';

// Engines
import { type RegulationResult, regulation } from '../engines/regulation/index.ts';

// Resource Access
import type { SessionUser } from '../resource-access/auth.ts';
import type { DatabaseHandle } from '../resource-access/database/database.ts';
import { NodeRA } from '../resource-access/nodes/node.ts';
import { ShareRA } from '../resource-access/shares/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export type ResolveDecision = 'grant' | 'decline';

//----------------------------------------------------------------------------------------------------------------------

export class ShareManager
{
    readonly #handle : DatabaseHandle;
    readonly #nodes : NodeRA;
    readonly #shares : ShareRA;

    constructor(handle : DatabaseHandle, nodes : NodeRA, shares : ShareRA)
    {
        this.#handle = handle;
        this.#nodes = nodes;
        this.#shares = shares;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Grants
    //------------------------------------------------------------------------------------------------------------------

    // POST /api/nodes/:id/shares. Owner-only in v1 (judgeGrant checks it against the loaded node). A grantee who
    // already holds a grant has their role updated rather than a conflict raised.
    async grant(actor : SessionUser, nodeID : string, request : GrantShareRequest) : Promise<ShareResponse>
    {
        const node = await this.#nodes.get(nodeID);
        if(node === undefined) { throw new NotFoundError(`No node ${ nodeID }.`); }

        const share = await this.#mintGrant(this.#shares, node, actor.id, request.granteeUserID, request.role);

        return toShareResponse(share);
    }

    // DELETE /api/shares/:id. Owner-only: ending someone else's access is the owner's call (a recipient uses leave).
    // The recipient's links go dead and persist as stubs -- correct dangling-symlink behavior, no cleanup here.
    async revoke(actor : SessionUser, shareID : string) : Promise<void>
    {
        const share = await this.#shares.getShareById(shareID);
        if(share === undefined) { throw new NotFoundError(`No share ${ shareID }.`); }

        // The share cascades with its node, so a missing node means the share is gone too.
        const node = await this.#nodes.get(share.nodeID);
        if(node === undefined) { throw new NotFoundError(`No share ${ shareID }.`); }
        if(!isDirectOwner(node, actor.id)) { throw new ForbiddenError('Only the owner may revoke a share.'); }

        await this.#shares.deleteShare(shareID);
    }

    // POST /api/shares/:id/leave. The recipient removes their own grant. Their links go dead and persist as
    // stubs; cleaning them up is a separate user-initiated action, not this call.
    async leave(actor : SessionUser, shareID : string) : Promise<void>
    {
        const share = await this.#shares.getShareById(shareID);
        if(share === undefined) { throw new NotFoundError(`No share ${ shareID }.`); }

        if(share.granteeUserID !== actor.id)
        {
            throw new ForbiddenError('Only the grantee may leave a share.');
        }

        await this.#shares.deleteShare(shareID);
    }

    // GET /api/nodes/:id/shares. The owner's view of who a node is shared with.
    async listForNode(actor : SessionUser, nodeID : string) : Promise<ShareListResponse>
    {
        const node = await this.#nodes.get(nodeID);
        if(node === undefined) { throw new NotFoundError(`No node ${ nodeID }.`); }
        if(!isDirectOwner(node, actor.id))
        {
            throw new ForbiddenError('Only the owner may list shares on this node.');
        }

        const shares = await this.#shares.listByNode(nodeID);

        return { shares: shares.map(toShareResponse) };
    }

    // GET /api/shared-with-me. The caller's active shares with each target's summary and whether they have placed a
    // link to it.
    async sharedWithMe(actor : SessionUser) : Promise<SharedWithMeResponse>
    {
        const rows = await this.#shares.sharedWithMe(actor.id);

        const entries = rows.map((row) => ({
            share: toShareResponse(row.share),
            target: row.target,
            placed: row.placed,
        }));

        return { entries };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Access requests
    //------------------------------------------------------------------------------------------------------------------

    // POST /api/nodes/:id/access-requests. A user who can see a stub but cannot resolve it asks the target's owner for
    // access. Rejected if they already have any access, or already have a request pending on this node.
    async requestAccess(actor : SessionUser, nodeID : string, request : CreateAccessRequest)
    : Promise<AccessRequestResponse>
    {
        const node = await this.#nodes.get(nodeID);
        if(node === undefined) { throw new NotFoundError(`No node ${ nodeID }.`); }

        const role = await this.#shares.effectiveRole(actor.id, nodeID);
        if(role !== null) { throw new BadRequestError('You already have access to this node.'); }

        const existing = await this.#shares.findPendingByNodeRequester(nodeID, actor.id);
        if(existing !== undefined) { throw new BadRequestError('You already have a pending request for this node.'); }

        const pending : PendingShareRequest = {
            id: createId(),
            nodeID,
            requesterID: actor.id,
            requestedRole: request.requestedRole,
            status: 'pending',
            resolvedAt: null,
            createdAt: new Date(),
        };
        await this.#shares.insertRequest(pending);

        return toAccessRequestResponse(pending);
    }

    // GET /api/access-requests. Both directions in one payload: the pending requests routed to the caller as an
    // owner (the actionable "Sharing requests" view), and the caller's own requests with their current status.
    async listAccessRequests(actor : SessionUser) : Promise<AccessRequestListResponse>
    {
        const [ incoming, outgoing ] = await Promise.all([
            this.#shares.listPendingByOwner(actor.id),
            this.#shares.listByRequester(actor.id),
        ]);

        return {
            incoming: incoming.map(toAccessRequestResponse),
            outgoing: outgoing.map(toAccessRequestResponse),
        };
    }

    // POST /api/access-requests/:id/{grant,decline}. Only the target's owner may resolve, and only a pending request
    // (judgeShareRequestResolution). Granting mints a share through the same grant path and resolves the request in one
    // transaction, so a crash can't leave a granted request without its share.
    async resolveRequest(actor : SessionUser, requestID : string, decision : ResolveDecision)
    : Promise<AccessRequestResponse>
    {
        const resolved = await this.#handle.db.transaction().execute(async (trx) =>
        {
            const txHandle : DatabaseHandle = { db: trx, kind: this.#handle.kind };
            const shares = new ShareRA(txHandle);
            const nodes = new NodeRA(txHandle);

            const request = await shares.getRequestById(requestID);
            if(request === undefined) { throw new NotFoundError(`No access request ${ requestID }.`); }

            const node = await nodes.get(request.nodeID);
            if(node === undefined) { throw new NotFoundError(`No node ${ request.nodeID }.`); }

            this.#enforce(regulation.share.resolveRequest({
                request,
                targetOwnerID: node.ownerID,
                actorID: actor.id,
            }));

            const now = new Date();
            if(decision === 'grant')
            {
                await this.#mintGrant(shares, node, actor.id, request.requesterID, request.requestedRole);
            }
            await shares.resolveRequest(request.id, decision === 'grant' ? 'granted' : 'declined', now);

            const outcome : ShareRequest = {
                id: request.id,
                nodeID: request.nodeID,
                requesterID: request.requesterID,
                requestedRole: request.requestedRole,
                createdAt: request.createdAt,
                status: decision === 'grant' ? 'granted' : 'declined',
                resolvedAt: now,
            };
            return outcome;
        });

        return toAccessRequestResponse(resolved);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Internals
    //------------------------------------------------------------------------------------------------------------------

    // The single granting path: judge the grant, then create it -- or, if the grantee already holds one,
    // update its role in place (the UNIQUE (node, grantee) row stands, so its id and provenance are preserved). Both a
    // direct grant and a request grant flow through here, against whichever RA (connection or transaction) the caller
    // passes.
    async #mintGrant(
        shares : ShareRA,
        node : Node,
        granterID : string,
        granteeID : string,
        role : ShareRole
    ) : Promise<Share>
    {
        this.#enforce(regulation.share.grant({ node, granterID, granteeID, role }));

        // A single upsert rather than read-then-write: two concurrent grants to the same grantee would otherwise both
        // see no existing row and race the UNIQUE constraint. The generated id is used only if the insert lands; a
        // re-grant keeps the existing row.
        return shares.upsertShare({
            id: createId(),
            nodeID: node.id,
            granteeUserID: granteeID,
            role,
            createdBy: granterID,
            createdAt: new Date(),
        });
    }

    #enforce(verdict : RegulationResult) : void
    {
        if(!verdict.ok) { throw new RegulationError(verdict.violations); }
    }
}

//----------------------------------------------------------------------------------------------------------------------
