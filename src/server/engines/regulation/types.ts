//----------------------------------------------------------------------------------------------------------------------
// Regulation Result
//
// Engines return these results and never throw; turning a violation into an HTTP-facing error is the manager's job. The
// violation vocabulary (codes and shape) is the wire contract and lives in @fileshed/core.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { RegulationViolation } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

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
