//----------------------------------------------------------------------------------------------------------------------
// Stock Theme
//
// What "default" means on the Branding tab, from sources a saved theme can never touch and Tailwind can never
// tree-shake: the pinned stock ramps and the STOCK_THEME constant vite.config.ts itself wires into Nuxt UI --
// one source, no drift, no live-token reads. Reads are only meaningful for unset knobs; a set knob displays its
// own value.
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
