//----------------------------------------------------------------------------------------------------------------------
// Stock Theme
//
// What "default" means on the Branding tab, read from sources a saved theme can't touch and Tailwind can't tree-shake:
// the pinned stock ramps and the STOCK_THEME constant vite.config.ts wires into Nuxt UI. Only unset knobs read these; a
// set knob shows its own value.
//----------------------------------------------------------------------------------------------------------------------

import {
    type NeutralFamily,
    STOCK_THEME,
    type ShadeKey,
    neutralFamilies,
    stockBrandRamps,
    themeColorToHex,
} from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

export function stockRampFor(alias : 'primary' | 'secondary') : Record<ShadeKey, string>
{
    return { ...stockBrandRamps[alias] };
}

// The default brand color as a hex, for the input that always shows the effective value.
export function stockHexFor(alias : 'primary' | 'secondary') : string | null
{
    return themeColorToHex(stockBrandRamps[alias]['500']);
}

export function stockNeutralFamily() : NeutralFamily | null
{
    return neutralFamilies.find((family) => family === STOCK_THEME.neutral) ?? null;
}

export function stockRadius() : number
{
    return STOCK_THEME.radius;
}

//----------------------------------------------------------------------------------------------------------------------
