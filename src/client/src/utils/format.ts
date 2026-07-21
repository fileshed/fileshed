//----------------------------------------------------------------------------------------------------------------------
// Byte and Quota Formatting
//
// Decimal units (1 KB = 1000 B) match the storage figures cloud drives present to users, and the requirements quote
// quota sizes the same way ("4 GB blob"). Precise binary sizing stays server-side; this is display only.
//----------------------------------------------------------------------------------------------------------------------

const BYTE_UNITS = [ 'B', 'KB', 'MB', 'GB', 'TB', 'PB' ] as const;
const STEP = 1000;

//----------------------------------------------------------------------------------------------------------------------

// Whole bytes below 1 KB; from there, step up by 1000s and show a single decimal place with a trailing ".0" trimmed.
// Negative or non-finite input reads as zero rather than "NaN B".
export function formatBytes(bytes : number) : string
{
    let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    let unit = 0;

    while(value >= STEP && unit < BYTE_UNITS.length - 1)
    {
        value /= STEP;
        unit += 1;
    }

    const label = BYTE_UNITS[unit] ?? 'B';
    const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');

    return `${ text } ${ label }`;
}

//----------------------------------------------------------------------------------------------------------------------

// The fraction of quota consumed, clamped to 0..100 for the meter. A null (unlimited) or non-positive cap has no
// meaningful percentage, so it reads as 0.
export function quotaPercent(used : number, limit : number | null) : number
{
    if(limit === null || limit <= 0) { return 0; }

    return Math.min(100, Math.max(0, (used / limit) * 100));
}

//----------------------------------------------------------------------------------------------------------------------
