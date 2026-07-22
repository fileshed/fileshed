//----------------------------------------------------------------------------------------------------------------------
// Quota Formatting
//
// The share of a storage quota consumed, for the meter. Display only -- precise accounting stays server-side.
//----------------------------------------------------------------------------------------------------------------------

// The fraction of quota consumed, clamped to 0..100 for the meter. A null (unlimited) or non-positive cap has no
// meaningful percentage, so it reads as 0.
export function quotaPercent(used : number, limit : number | null) : number
{
    if(limit === null || limit <= 0) { return 0; }

    return Math.min(100, Math.max(0, (used / limit) * 100));
}

//----------------------------------------------------------------------------------------------------------------------
