//----------------------------------------------------------------------------------------------------------------------
// Regulation Violation Vocabulary
//
// The typed result of a legality judgement (requirements.md sec 3.6, layer 2). Engines RETURN these results and never
// throw -- turning a violation into an HTTP-facing error is a manager's job. A code is stable and machine-readable so
// managers and clients can branch on it without parsing the human message.
//----------------------------------------------------------------------------------------------------------------------

//----------------------------------------------------------------------------------------------------------------------
// Codes
//----------------------------------------------------------------------------------------------------------------------

export type RegulationCode
    = | 'link.targetIsLink'
    | 'link.selfTarget'
    | 'link.noAccess'
    | 'parent.notFolder'
    | 'parent.trashed'
    | 'parent.crossOwner'
    | 'move.intoSelf'
    | 'move.intoDescendant'
    | 'trash.linkNotTrashable'
    | 'trash.notOwner'
    | 'share.linkNotShareable'
    | 'share.notOwner'
    | 'share.granteeIsOwner'
    | 'shareRequest.notPending'
    | 'shareRequest.notOwner'
    | 'quota.exceeded';

//----------------------------------------------------------------------------------------------------------------------
// Violation & Result
//----------------------------------------------------------------------------------------------------------------------

export interface RegulationViolation
{
    code : RegulationCode;
    message : string;
    nodeID ?: string;
    parentID ?: string;
    targetNodeID ?: string;
    actorID ?: string;
    ownerID ?: string;
    granteeID ?: string;
    requestID ?: string;
}

export type RegulationResult
    = | { ok : true }
    | { ok : false; violations : RegulationViolation[] };

//----------------------------------------------------------------------------------------------------------------------
// Result Construction
//----------------------------------------------------------------------------------------------------------------------

// A judgement passes exactly when it gathered no violations; each engine accumulates into an array and funnels it
// through here so "no violations" and "ok" can never disagree.
export function resultOf(violations : RegulationViolation[]) : RegulationResult
{
    return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

// Fold several judgements into one, concatenating their violations. Managers gathering multiple facts for a single
// operation (e.g. parent-edge legality AND quota admission for one upload) combine the verdicts here.
export function combine(results : readonly RegulationResult[]) : RegulationResult
{
    const violations = results.flatMap((result) =>
    {
        return result.ok ? [] : result.violations;
    });
    return resultOf(violations);
}

//----------------------------------------------------------------------------------------------------------------------
