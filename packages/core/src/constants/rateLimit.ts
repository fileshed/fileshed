//----------------------------------------------------------------------------------------------------------------------
// Rate Limit Defaults
//
// Budgets per client per window, generous by design: this is a cost ceiling on an unauthenticated flood, not a quality
// -of-service policy for the people using the instance. A limit a real session can reach is a limit an operator turns
// off, and an operator who turned it off has none.
//----------------------------------------------------------------------------------------------------------------------

export const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;

// The general API budget. Ten requests a second sustained covers a drive listing whose whole grid asks for a thumbnail
// at once, and covers a chunked upload at the default chunk size faster than any WAN link delivers it.
export const DEFAULT_RATE_LIMIT_MAX = 600;

// Everything that spends or issues a credential -- sign-in, sign-up, password reset, verification. Ten a minute is
// past what a person fumbling a password reaches and nowhere near what guessing needs.
export const DEFAULT_RATE_LIMIT_CREDENTIALS_MAX = 10;

// Anonymous public-link reads. The token is 256 bits, so this is not about guessing it; it is about what an
// unauthenticated stranger can make the database do.
export const DEFAULT_RATE_LIMIT_ANONYMOUS_MAX = 120;

// Live buckets held in memory before the oldest are dropped. At roughly a hundred bytes each this is single-digit
// megabytes, and an eviction only forgives requests already counted.
export const RATE_LIMIT_MAX_BUCKETS = 100_000;

// Addresses are keyed by their /64, because that is the smallest block an IPv6 client is routinely handed whole.
// Keying the full 128 bits would let one connection rotate through 18 quintillion buckets.
export const IPV6_BUCKET_PREFIX = 64;

//----------------------------------------------------------------------------------------------------------------------
