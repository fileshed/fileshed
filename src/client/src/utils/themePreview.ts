//----------------------------------------------------------------------------------------------------------------------
// Theme Preview
//
// Draft token variables are written onto the document element, where they override the branding stylesheet by
// specificity. The module remembers what it applied so a knob returning to stock clears its variables; a leftover
// inline variable would shadow the stylesheet for the life of the page.
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
