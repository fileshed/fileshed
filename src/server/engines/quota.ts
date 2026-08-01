//----------------------------------------------------------------------------------------------------------------------
// Quota Engine
//
// One rule, in one place: what an account's storage cap actually is, once the instance default has had its say.
//
// A per-user limit carries three states in one nullable column. null inherits the instance default -- the state a
// fresh account is born in, and the one that lets an admin move every uncustomized account at once. 0 is an explicit
// "no cap on this account", which is what pins a user above a tightened default. Anything positive is a byte cap.
// The instance default speaks the same 0-is-unlimited dialect, so a deployment that never touches quotas resolves
// every account to unlimited, exactly as it did before quotas were configurable.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { UNLIMITED_QUOTA } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

// The cap to enforce, or null for unlimited -- the shape the regulation engine's limitBytes takes.
export function effectiveQuota(userLimit : number | null, instanceDefault : number) : number | null
{
    const limit = userLimit ?? instanceDefault;

    return limit === UNLIMITED_QUOTA ? null : limit;
}

//----------------------------------------------------------------------------------------------------------------------
