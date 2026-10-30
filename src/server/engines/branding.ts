//----------------------------------------------------------------------------------------------------------------------
// Branding Engine
//
// The admin's custom CSS goes last, verbatim, so it can override anything the token variables set. A fully stock theme
// renders to nothing: the build-time look is the default and is never copied in.
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
