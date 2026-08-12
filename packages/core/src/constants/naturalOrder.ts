//----------------------------------------------------------------------------------------------------------------------
// Natural Order Constants
//
// Two spellings of one ordering rule, and they must move together: the JS collator options the client and the SQLite
// listing sort through, and the ICU locale the Postgres collation is built from. The locale is pinned rather than left
// to the runtime because one server serves every reader -- an index is built once, and a viewer whose machine says
// sv-SE would otherwise order the same folder differently than the folder was stored.
//----------------------------------------------------------------------------------------------------------------------

export const NATURAL_ORDER_LOCALE = 'en';

export const NATURAL_ORDER_OPTIONS : Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };

// `kn-true` is the numeric ordering that puts track-9 ahead of track-10; `ks-level1` is primary strength, which is
// what `sensitivity: 'base'` means -- case and accents never separate two names. The collation is created
// non-deterministic so Postgres reports a genuine tie instead of breaking it by byte comparison inside the ORDER BY
// term, which is what lets the id tiebreak run and match the client.
export const NATURAL_ORDER_ICU_LOCALE = 'en-u-kn-true-ks-level1';

export const NATURAL_ORDER_COLLATION = 'fileshed_natural';

//----------------------------------------------------------------------------------------------------------------------
