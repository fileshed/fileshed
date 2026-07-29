//----------------------------------------------------------------------------------------------------------------------
// Theme Preview
//
// The live half of the Branding tab: draft token variables written straight onto the document element, where
// they override the branding stylesheet by specificity and repaint the whole app as a knob moves. The module
// remembers what it applied so a knob returning to stock actually CLEARS its variables -- leftover inline vars
// would shadow the stylesheet forever.
//----------------------------------------------------------------------------------------------------------------------

let applied = new Set<string>();

export function applyThemePreview(variables : Record<string, string>) : void
{
    const style = document.documentElement.style;
    const next = new Set(Object.keys(variables));

    for(const name of applied)
    {
        if(!next.has(name)) { style.removeProperty(name); }
    }

    for(const [ name, value ] of Object.entries(variables))
    {
        style.setProperty(name, value);
    }

    applied = next;
}

export function clearThemePreview() : void
{
    applyThemePreview({});
}

//----------------------------------------------------------------------------------------------------------------------
