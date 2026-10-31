//----------------------------------------------------------------------------------------------------------------------
// Node Admission
//
// Every node-creating manager goes through these checks, so an upload and a folder create are held to the same
// placement and quota rules.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { ForbiddenError, type Node, NotFoundError, type Role } from '@fileshed/core';

// Engines
import { effectiveQuota } from '../engines/quota.ts';
import { type RegulationResult, regulation } from '../engines/regulation/index.ts';

// Resource Access
import type { NodeRA } from '../resource-access/nodes/index.ts';
import type { ShareRA } from '../resource-access/shares/index.ts';
import type { UserRA } from '../resource-access/users/index.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface NodeAdmissionDeps
{
    nodes : NodeRA;
    shares : ShareRA;
    users : UserRA;
    defaultQuota : () => Promise<number>;
}

//----------------------------------------------------------------------------------------------------------------------

export class NodeAdmission
{
    readonly #nodes : NodeRA;
    readonly #shares : ShareRA;
    readonly #users : UserRA;
    readonly #defaultQuota : () => Promise<number>;

    constructor(deps : NodeAdmissionDeps)
    {
        this.#nodes = deps.nodes;
        this.#shares = deps.shares;
        this.#users = deps.users;
        this.#defaultQuota = deps.defaultQuota;
    }

    async gatherParent(parentID : string | null) : Promise<Node | null>
    {
        if(parentID === null) { return null; }

        const parent = await this.#nodes.get(parentID);
        if(parent === undefined) { throw new NotFoundError(`No parent node ${ parentID }.`); }

        return parent;
    }

    // The parent edge alone: a folder (live, or the root) the creator holds editor+ on.
    async judgeParentEdge(creatorID : string, parent : Node | null) : Promise<RegulationResult>
    {
        const creatorRoleOnParent = parent === null ? null : await this.#shares.effectiveRole(creatorID, parent.id);

        return regulation.node.parentEdge({ creatorID, parent, creatorRoleOnParent });
    }

    // Both rules a destination must satisfy, for a create (nothing rides along, so `placedHeight` stays 0) and a move
    // alike: the parent edge is legal for the creator, and the deepest node the placement lands still sits inside the
    // depth every parent-edge walk climbs. A caller that has already walked the destination's chain -- the move judge
    // needs it for the cycle check -- passes it in, so a move costs one walk rather than two.
    async judgePlacement(
        creatorID : string,
        parent : Node | null,
        placedHeight = 0,
        parentAncestorIDs ?: string[]
    ) : Promise<RegulationResult>
    {
        const [ creatorRoleOnParent, ancestorIDs ] : [ Role | null, string[] ] = parent === null
            ? [ null, [] ]
            : await Promise.all([
                this.#shares.effectiveRole(creatorID, parent.id),
                parentAncestorIDs ?? this.#nodes.ancestorIDs(parent.id),
            ]);

        return regulation.combine([
            regulation.node.parentEdge({ creatorID, parent, creatorRoleOnParent }),
            regulation.node.placementDepth({
                parentID: parent === null ? null : parent.id,
                placedDepth: parent === null ? 0 : ancestorIDs.length + 1,
                placedHeight,
            }),
        ]);
    }

    // The cap an owner is held to right now: their quota_limit read from their user row, with the instance default
    // folded in. Keyed by owner rather than taken from the caller's session, because a replace is charged to the
    // file's owner, who is often not the caller.
    //
    // Always called BEFORE a transaction opens: it reads the user row and the settings row, and SQLite serializes
    // writes, so a read issued from inside an open write transaction on the same handle deadlocks the commit. The
    // resolved limit is then carried into the transaction as a plain number.
    async resolveLimit(ownerID : string) : Promise<number | null>
    {
        const [ userLimit, instanceDefault ] = await Promise.all([
            this.#users.quotaLimitOf(ownerID),
            this.#defaultQuota(),
        ]);

        return effectiveQuota(userLimit, instanceDefault);
    }

    // Judge one write against an owner's quota and throw the quota message on refusal. Keyed by ownerID and an
    // already-resolved limit so it serves both the caller-charged creates (the caller is the owner) and the
    // owner-charged replace (an editor's write is charged to the file's owner). usedBytes is passed in so the caller
    // controls whether it was read outside the commit (the early gate) or inside it (the authoritative re-check).
    // incomingBytes is the DELTA for a replace, which may be negative.
    enforceQuota(ownerID : string, usedBytes : number, incomingBytes : number, limitBytes : number | null) : void
    {
        const verdict = regulation.quota.admit({ ownerID, usedBytes, limitBytes, incomingBytes });

        if(!verdict.ok)
        {
            throw new ForbiddenError(verdict.violations[0]?.message ?? 'This write would exceed the storage quota.');
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
