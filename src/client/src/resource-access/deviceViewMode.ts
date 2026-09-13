//----------------------------------------------------------------------------------------------------------------------
// Device View Mode
//
// This browser's own grid-vs-list choice, which outranks the one stored on the account. The account preference is
// what a device inherits before it has expressed an opinion; once somebody chooses on a device, that device keeps
// its choice, so a phone can sit on list while the desktop stays on grid without the two overwriting each other.
//
// localStorage can throw -- private-mode quotas, a blocked cookie policy -- so every access is guarded and a browser
// that refuses simply has no opinion, falling back to the account's.
//----------------------------------------------------------------------------------------------------------------------

import type { ViewMode } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const DEVICE_VIEW_MODE_KEY = 'fileshed.drive.deviceViewMode';

//----------------------------------------------------------------------------------------------------------------------

export function readDeviceViewMode() : ViewMode | null
{
    try
    {
        const stored = window.localStorage.getItem(DEVICE_VIEW_MODE_KEY);

        return stored === 'grid' || stored === 'list' ? stored : null;
    }
    catch
    {
        return null;
    }
}

export function writeDeviceViewMode(mode : ViewMode) : void
{
    try { window.localStorage.setItem(DEVICE_VIEW_MODE_KEY, mode); }
    catch { /* a browser that refuses to remember simply follows the account preference */ }
}

//----------------------------------------------------------------------------------------------------------------------
