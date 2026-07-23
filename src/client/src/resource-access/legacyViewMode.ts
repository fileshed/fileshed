//----------------------------------------------------------------------------------------------------------------------
// Legacy View Mode
//
// One-shot migration off the pre-preferences-blob storage of the drive's grid-vs-list choice: a localStorage key that
// predates viewMode joining the server-side preferences blob. Reading also clears the key -- it is consulted at most
// once per browser, whether or not its value ends up adopted. localStorage can throw (private-mode quotas, a blocked
// cookie policy), so every access is guarded.
//----------------------------------------------------------------------------------------------------------------------

import type { ViewMode } from '@fileshed/core';

const VIEW_MODE_KEY = 'fileshed.drive.viewMode';

//----------------------------------------------------------------------------------------------------------------------

export function takeLegacyViewMode() : ViewMode | null
{
    try
    {
        const stored = window.localStorage.getItem(VIEW_MODE_KEY);
        window.localStorage.removeItem(VIEW_MODE_KEY);

        return stored === 'grid' || stored === 'list' ? stored : null;
    }
    catch
    {
        return null;
    }
}

//----------------------------------------------------------------------------------------------------------------------
