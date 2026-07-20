//----------------------------------------------------------------------------------------------------------------------
// Quota Regulation
//
// Admission control for a write against the owner's storage quota. Pure -- the manager gathers
// the charged usage and limit, the engine judges the numbers it is handed. Dedup and trashed-vs-live semantics are
// already baked into `usedBytes` upstream; this layer only compares.
//----------------------------------------------------------------------------------------------------------------------

// Regulation
import { type RegulationResult, resultOf } from './types.ts';

//----------------------------------------------------------------------------------------------------------------------

// `usedBytes` is the owner's current charged usage (sum of logical sizes of their owned, non-purged file nodes,
// including trashed). `limitBytes` of null means unlimited.
export interface QuotaFacts
{
    ownerID : string;
    usedBytes : number;
    limitBytes : number | null;
    incomingBytes : number;
}

// Reject when used + incoming exceeds the limit. Exactly at the limit is admitted; a null limit admits anything.
export function judgeQuotaAdmission(facts : QuotaFacts) : RegulationResult
{
    if(facts.limitBytes === null) { return resultOf([]); }

    if(facts.usedBytes + facts.incomingBytes > facts.limitBytes)
    {
        return resultOf([ {
            code: 'quota.exceeded',
            message: 'This write would exceed the owner\'s storage quota.',
            ownerID: facts.ownerID,
        } ]);
    }

    return resultOf([]);
}

//----------------------------------------------------------------------------------------------------------------------
