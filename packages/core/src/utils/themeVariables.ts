//----------------------------------------------------------------------------------------------------------------------
// Theme Variables
//
// One InstanceTheme becomes the CSS custom properties Nuxt UI's tokens read, shared by the two consumers that
// must never disagree: the server renders them into /api/branding.css, the admin's live preview writes them
// straight onto the document element. Only set knobs emit anything -- a stock theme produces an empty map, and
// the build-time look stays untouched.
//----------------------------------------------------------------------------------------------------------------------

// Models
import type { InstanceTheme, NeutralFamily } from '../models/instanceTheme.ts';

// Utils
import { type ShadeKey, colorRamp, shadeKeys } from './colorRamp.ts';

//----------------------------------------------------------------------------------------------------------------------

// The five Tailwind gray families, verbatim from the installed tailwindcss theme -- a spec pins these against
// node_modules so a Tailwind bump that shifts a gray fails the build's tests instead of silently drifting.
export const neutralPalettes : Readonly<Record<NeutralFamily, Readonly<Record<ShadeKey, string>>>> = {
    slate: {
        50: 'oklch(98.4% 0.003 247.858)',
        100: 'oklch(96.8% 0.007 247.896)',
        200: 'oklch(92.9% 0.013 255.508)',
        300: 'oklch(86.9% 0.022 252.894)',
        400: 'oklch(70.4% 0.04 256.788)',
        500: 'oklch(55.4% 0.046 257.417)',
        600: 'oklch(44.6% 0.043 257.281)',
        700: 'oklch(37.2% 0.044 257.287)',
        800: 'oklch(27.9% 0.041 260.031)',
        900: 'oklch(20.8% 0.042 265.755)',
        950: 'oklch(12.9% 0.042 264.695)',
    },
    gray: {
        50: 'oklch(98.5% 0.002 247.839)',
        100: 'oklch(96.7% 0.003 264.542)',
        200: 'oklch(92.8% 0.006 264.531)',
        300: 'oklch(87.2% 0.01 258.338)',
        400: 'oklch(70.7% 0.022 261.325)',
        500: 'oklch(55.1% 0.027 264.364)',
        600: 'oklch(44.6% 0.03 256.802)',
        700: 'oklch(37.3% 0.034 259.733)',
        800: 'oklch(27.8% 0.033 256.848)',
        900: 'oklch(21% 0.034 264.665)',
        950: 'oklch(13% 0.028 261.692)',
    },
    zinc: {
        50: 'oklch(98.5% 0 none)',
        100: 'oklch(96.7% 0.001 286.375)',
        200: 'oklch(92% 0.004 286.32)',
        300: 'oklch(87.1% 0.006 286.286)',
        400: 'oklch(70.5% 0.015 286.067)',
        500: 'oklch(55.2% 0.016 285.938)',
        600: 'oklch(44.2% 0.017 285.786)',
        700: 'oklch(37% 0.013 285.805)',
        800: 'oklch(27.4% 0.006 286.033)',
        900: 'oklch(21% 0.006 285.885)',
        950: 'oklch(14.1% 0.005 285.823)',
    },
    neutral: {
        50: 'oklch(98.5% 0 none)',
        100: 'oklch(97% 0 none)',
        200: 'oklch(92.2% 0 none)',
        300: 'oklch(87% 0 none)',
        400: 'oklch(70.8% 0 none)',
        500: 'oklch(55.6% 0 none)',
        600: 'oklch(43.9% 0 none)',
        700: 'oklch(37.1% 0 none)',
        800: 'oklch(26.9% 0 none)',
        900: 'oklch(20.5% 0 none)',
        950: 'oklch(14.5% 0 none)',
    },
    stone: {
        50: 'oklch(98.5% 0.001 106.423)',
        100: 'oklch(97% 0.001 106.424)',
        200: 'oklch(92.3% 0.003 48.717)',
        300: 'oklch(86.9% 0.005 56.366)',
        400: 'oklch(70.9% 0.01 56.259)',
        500: 'oklch(55.3% 0.013 58.071)',
        600: 'oklch(44.4% 0.011 73.639)',
        700: 'oklch(37.4% 0.01 67.558)',
        800: 'oklch(26.8% 0.007 34.298)',
        900: 'oklch(21.6% 0.006 56.043)',
        950: 'oklch(14.7% 0.004 49.25)',
    },
};

//----------------------------------------------------------------------------------------------------------------------

// The stock brand ramps, pinned as data because live tokens cannot be trusted for them: Tailwind tree-shakes
// unused family shades (--color-violet-300 may simply not exist in the emitted CSS), and the --ui-color-*
// aliases get overridden by any saved theme. Primary mirrors the shed palette in the client's main.css,
// secondary mirrors Tailwind's violet -- each pinned by a spec against its source, so drift fails the build.
export const stockBrandRamps : Readonly<Record<'primary' | 'secondary', Readonly<Record<ShadeKey, string>>>> = {
    primary: {
        50: '#fff8eb',
        100: '#ffedcc',
        200: '#ffd999',
        300: '#ffc266',
        400: '#ffab33',
        500: '#ff9900',
        600: '#db7c00',
        700: '#b76200',
        800: '#934b00',
        900: '#7a3d03',
        950: '#421f00',
    },
    secondary: {
        50: 'oklch(96.9% 0.016 293.756)',
        100: 'oklch(94.3% 0.029 294.588)',
        200: 'oklch(89.4% 0.057 293.283)',
        300: 'oklch(81.1% 0.111 293.571)',
        400: 'oklch(70.2% 0.183 293.541)',
        500: 'oklch(60.6% 0.25 292.717)',
        600: 'oklch(54.1% 0.281 293.009)',
        700: 'oklch(49.1% 0.27 292.581)',
        800: 'oklch(43.2% 0.232 292.759)',
        900: 'oklch(38% 0.189 293.745)',
        950: 'oklch(28.3% 0.141 291.089)',
    },
};

export function buildThemeVariables(theme : InstanceTheme) : Record<string, string>
{
    const variables : Record<string, string> = {};

    if(theme.primary !== null)
    {
        const ramp = colorRamp(theme.primary);
        for(const shade of shadeKeys) { variables[`--ui-color-primary-${ shade }`] = ramp[shade]; }
    }

    if(theme.secondary !== null)
    {
        const ramp = colorRamp(theme.secondary);
        for(const shade of shadeKeys) { variables[`--ui-color-secondary-${ shade }`] = ramp[shade]; }
    }

    if(theme.neutral !== null)
    {
        const palette = neutralPalettes[theme.neutral];
        for(const shade of shadeKeys) { variables[`--ui-color-neutral-${ shade }`] = palette[shade]; }
    }

    if(theme.radius !== null)
    {
        variables['--ui-radius'] = `${ theme.radius }rem`;
    }

    return variables;
}

//----------------------------------------------------------------------------------------------------------------------
