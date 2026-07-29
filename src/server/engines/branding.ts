//----------------------------------------------------------------------------------------------------------------------
// Branding Engine
//
// One theme document becomes the stylesheet /api/branding.css serves: the token variables Nuxt UI reads in a
// :root block, then the admin's custom CSS verbatim, last -- so the escape hatch can override anything the
// tokens said. A fully stock theme renders to nothing at all; the build-time look is the default, not a copy.
//----------------------------------------------------------------------------------------------------------------------

// Models
import { type InstanceTheme, buildThemeVariables } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export function renderBrandingCSS(theme : InstanceTheme) : string
{
    const variables = Object.entries(buildThemeVariables(theme));
    const parts : string[] = [];

    if(variables.length > 0)
    {
        const lines = variables.map(([ name, value ]) => `    ${ name }: ${ value };`).join('\n');
        parts.push(`:root {\n${ lines }\n}`);
    }

    if(theme.customCSS !== null && theme.customCSS.trim() !== '')
    {
        parts.push(theme.customCSS);
    }

    return parts.length === 0 ? '' : `${ parts.join('\n\n') }\n`;
}

//----------------------------------------------------------------------------------------------------------------------
