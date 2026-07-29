//----------------------------------------------------------------------------------------------------------------------
// Color Mode Engine
//
// The one resolution rule for which mode wins: a forced instance mode beats everyone (that is what forcing
// means), the user's own choice beats the instance default, and with neither the instance default stands. No
// branding facts at all -- the instance hasn't answered yet -- resolves to following the system.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { ColorMode, InstanceBranding } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export function resolveColorMode(
    branding : Pick<InstanceBranding, 'mode' | 'forcedMode'> | null,
    userChoice : ColorMode | undefined
) : ColorMode
{
    if(branding === null) { return 'system'; }
    if(branding.forcedMode) { return branding.mode; }

    return userChoice ?? branding.mode;
}

// Whether a resolved mode paints dark right now: 'system' consults the OS preference the caller read, and a
// platform with no such signal reads as light.
export function resolvesToDark(mode : ColorMode, systemPrefersDark : boolean) : boolean
{
    return mode === 'dark' || (mode === 'system' && systemPrefersDark);
}

//----------------------------------------------------------------------------------------------------------------------
