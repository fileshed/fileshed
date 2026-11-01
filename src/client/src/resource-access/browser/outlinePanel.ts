//----------------------------------------------------------------------------------------------------------------------
// Outline Panel
//
// Whether the markdown editor's outline panel is open, remembered per browser. localStorage can throw (private-mode
// quotas, a blocked cookie policy), so a browser that refuses simply has no stored choice.
//----------------------------------------------------------------------------------------------------------------------

const OUTLINE_PANEL_KEY = 'fileshed.markdown.outlinePanelOpen';

//----------------------------------------------------------------------------------------------------------------------

export function readOutlinePanelOpen() : boolean | null
{
    try
    {
        const stored = window.localStorage.getItem(OUTLINE_PANEL_KEY);
        if(stored === 'true') { return true; }

        return stored === 'false' ? false : null;
    }
    catch
    {
        return null;
    }
}

export function writeOutlinePanelOpen(open : boolean) : void
{
    try { window.localStorage.setItem(OUTLINE_PANEL_KEY, String(open)); }
    catch { /* a browser that refuses to remember opens the panel every time */ }
}

//----------------------------------------------------------------------------------------------------------------------
