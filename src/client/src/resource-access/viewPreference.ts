//----------------------------------------------------------------------------------------------------------------------
// View Preferences
//
// The drive's grid-vs-list choice, persisted so it survives a reload. localStorage can throw (private-mode quotas, a
// blocked cookie policy), so every access is guarded and falls back to the grid default rather than letting a storage
// error break the view.
//----------------------------------------------------------------------------------------------------------------------

const VIEW_MODE_KEY = 'fileshed.drive.viewMode';

export type ViewMode = 'grid' | 'list';

const DEFAULT_VIEW_MODE : ViewMode = 'grid';

//----------------------------------------------------------------------------------------------------------------------

export function loadViewMode() : ViewMode
{
    try
    {
        const stored = window.localStorage.getItem(VIEW_MODE_KEY);
        return stored === 'grid' || stored === 'list' ? stored : DEFAULT_VIEW_MODE;
    }
    catch
    {
        return DEFAULT_VIEW_MODE;
    }
}

export function saveViewMode(mode : ViewMode) : void
{
    try
    {
        window.localStorage.setItem(VIEW_MODE_KEY, mode);
    }
    catch
    {
        // A failed persist is not worth surfacing -- the session keeps the choice in memory regardless.
    }
}

//----------------------------------------------------------------------------------------------------------------------
