//----------------------------------------------------------------------------------------------------------------------
// Quota Formatting
//----------------------------------------------------------------------------------------------------------------------

import { QUOTA_WARNING_PERCENT } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// What a gauge measures: bytes charged, against the cap actually enforced with the instance default already folded
// in. A null cap is unlimited; a null quota altogether is a profile that has not loaded yet.
export interface QuotaGauge
{
    used : number;
    effective : number | null;
}

//----------------------------------------------------------------------------------------------------------------------

// The fraction of quota consumed, clamped to 0..100 for the meter. A null (unlimited) or non-positive cap has no
// meaningful percentage, so it reads as 0.
export function quotaPercent(used : number, limit : number | null) : number
{
    if(limit === null || limit <= 0) { return 0; }

    return Math.min(100, Math.max(0, (used / limit) * 100));
}

// Whether the gauge should wear the warning color. An account nothing caps can never be nearing a cap.
export function nearingQuotaCap(quota : QuotaGauge | null) : boolean
{
    if(!quota || quota.effective === null) { return false; }

    return quotaPercent(quota.used, quota.effective) >= QUOTA_WARNING_PERCENT;
}

// The hover detail: the share of quota consumed, only meaningful when a cap exists.
export function quotaHoverLabel(quota : QuotaGauge | null) : string | undefined
{
    if(!quota || quota.effective === null) { return undefined; }

    return `${ Math.round(quotaPercent(quota.used, quota.effective)) }% of your storage used`;
}

//----------------------------------------------------------------------------------------------------------------------
