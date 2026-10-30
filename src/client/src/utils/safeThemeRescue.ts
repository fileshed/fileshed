//----------------------------------------------------------------------------------------------------------------------
// Safe Theme Rescue
//
// The way back from custom CSS that made the UI unusable: `?safe-theme` on any URL drops the branding stylesheet
// before the app mounts, so the admin who bricked the theme from a browser can un-brick it from the same browser.
// The check runs on every boot, unconditionally -- no stylesheet, however hostile, can stop a script. It holds for
// the life of the document; a reload without the parameter brings branding back, which is why nothing is stored.
//
// The href is matched loosely because a Save cache-busts the link with a ?v= query.
//----------------------------------------------------------------------------------------------------------------------

const SAFE_THEME_PARAM = 'safe-theme';
const BRANDING_LINK_SELECTOR = 'link[href*="branding.css"]';

//----------------------------------------------------------------------------------------------------------------------

export function applySafeThemeRescue(search : string, doc : Document) : void
{
    if(!new URLSearchParams(search).has(SAFE_THEME_PARAM)) { return; }

    doc.querySelectorAll(BRANDING_LINK_SELECTOR).forEach((link) =>
    {
        link.remove();
    });
}

//----------------------------------------------------------------------------------------------------------------------
