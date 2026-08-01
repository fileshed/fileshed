//----------------------------------------------------------------------------------------------------------------------
// Quota Constants
//----------------------------------------------------------------------------------------------------------------------

// The share of a quota at which the storage gauges turn to a warning color.
export const QUOTA_WARNING_PERCENT = 80;

// The sentinel that spells "no cap" in a byte count, for both the instance-wide default and an explicit per-user
// limit. A quota needs three states -- inherit, unlimited, capped -- and null already spends itself on inherit, so
// unlimited rides a magnitude no real cap would ever take. See the quota engine for the resolution.
export const UNLIMITED_QUOTA = 0;

//----------------------------------------------------------------------------------------------------------------------
