//----------------------------------------------------------------------------------------------------------------------
// Share Regulation
//
// Cross-record legality for permission grants (secs 3.4/3.5): who may create a share and on what, plus the authority to
// resolve a share request. Pure -- the manager gathers ownership facts, the engine judges (requirements.md sec 3.6).
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { Node, RegulationViolation, ShareRequest, ShareRole } from '@fileshed/core';

// Regulation
import { type RegulationResult, resultOf } from './types.ts';

//----------------------------------------------------------------------------------------------------------------------
// Grant Legality
//----------------------------------------------------------------------------------------------------------------------

// `role` is a ShareRole by type -- an owner grant is unrepresentable, so the engine never re-checks it.
export interface GrantFacts
{
    node : Node;
    granterID : string;
    granteeID : string;
    role : ShareRole;
}

// secs 3.2b/3.4: only a node's owner may create a share in v1, a link carries no ACL and so cannot be shared, and the
// owner cannot grant themselves access. Every applicable condition is reported.
export function judgeGrant(facts : GrantFacts) : RegulationResult
{
    const { node } = facts;
    const violations : RegulationViolation[] = [];

    if(node.type === 'link')
    {
        violations.push({
            code: 'share.linkNotShareable',
            message: 'A link carries no ACL and cannot be shared.',
            nodeID: node.id,
        });
    }

    if(facts.granterID !== node.ownerID)
    {
        violations.push({
            code: 'share.notOwner',
            message: 'Only a node\'s owner may share it.',
            nodeID: node.id,
            actorID: facts.granterID,
            ownerID: node.ownerID,
        });
    }

    if(facts.granteeID === node.ownerID)
    {
        violations.push({
            code: 'share.granteeIsOwner',
            message: 'A node\'s owner cannot be granted a share on it.',
            nodeID: node.id,
            granteeID: facts.granteeID,
            ownerID: node.ownerID,
        });
    }

    return resultOf(violations);
}

//----------------------------------------------------------------------------------------------------------------------
// Share-Request Resolution
//----------------------------------------------------------------------------------------------------------------------

// `targetOwnerID` is the owner of the requested node, gathered by the manager -- share requests route to the target's
// owner, never the folder sharer who has no granting authority in v1 (sec 3.5).
export interface ShareRequestResolutionFacts
{
    request : ShareRequest;
    targetOwnerID : string;
    actorID : string;
}

// sec 3.5: only the target's owner may grant or decline, and only a pending request can be resolved. Legality is the
// same for grant and decline; a granted request mints an ordinary share carrying the request's requestedRole, which is
// the manager's to create once this passes.
export function judgeShareRequestResolution(facts : ShareRequestResolutionFacts) : RegulationResult
{
    const { request } = facts;
    const violations : RegulationViolation[] = [];

    if(request.status !== 'pending')
    {
        violations.push({
            code: 'shareRequest.notPending',
            message: 'Only a pending share request can be resolved.',
            requestID: request.id,
            nodeID: request.nodeID,
        });
    }

    if(facts.actorID !== facts.targetOwnerID)
    {
        violations.push({
            code: 'shareRequest.notOwner',
            message: 'Only the target\'s owner may resolve a share request.',
            requestID: request.id,
            nodeID: request.nodeID,
            actorID: facts.actorID,
            ownerID: facts.targetOwnerID,
        });
    }

    return resultOf(violations);
}

//----------------------------------------------------------------------------------------------------------------------
