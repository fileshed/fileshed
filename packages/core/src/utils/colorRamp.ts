//----------------------------------------------------------------------------------------------------------------------
// Color Ramp
//
// One admin-picked hex becomes the eleven-shade palette Nuxt UI's tokens expect, the way Tailwind's own palettes
// are built: the picked color IS shade 500, verbatim; lighter and darker shades walk a fixed OKLCH lightness
// curve toward near-white and near-black while chroma tapers at the ends and hue never drifts. Every output is
// gamut-mapped back into sRGB (chroma gives way, never lightness or hue), so a maximally saturated pick still
// yields eleven valid hex colors.
//----------------------------------------------------------------------------------------------------------------------

export const shadeKeys = [ '50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950' ] as const;
export type ShadeKey = typeof shadeKeys[number];

export type ColorRamp = Record<ShadeKey, string>;

//----------------------------------------------------------------------------------------------------------------------
// sRGB <-> OKLab (Björn Ottosson's reference matrices)
//----------------------------------------------------------------------------------------------------------------------

interface Oklch { lightness : number; chroma : number; hue : number; }

export function parseHexColor(value : string) : [ number, number, number ] | null
{
    const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if(match === null) { return null; }

    const digits = match[1] ?? '';

    return [
        parseInt(digits.slice(0, 2), 16) / 255,
        parseInt(digits.slice(2, 4), 16) / 255,
        parseInt(digits.slice(4, 6), 16) / 255,
    ];
}

function srgbToLinear(channel : number) : number
{
    return channel <= 0.04045 ? channel / 12.92 : (((channel + 0.055) / 1.055) ** 2.4);
}

function linearToSrgb(channel : number) : number
{
    return channel <= 0.0031308 ? channel * 12.92 : ((1.055 * (channel ** (1 / 2.4))) - 0.055);
}

function hexToOklch(hex : string) : Oklch
{
    const parsed = parseHexColor(hex);
    if(parsed === null) { throw new Error(`'${ hex }' is not a #rrggbb color.`); }

    const [ red, green, blue ] = parsed.map(srgbToLinear) as [ number, number, number ];

    const coneL = Math.cbrt((0.4122214708 * red) + (0.5363325363 * green) + (0.0514459929 * blue));
    const coneM = Math.cbrt((0.2119034982 * red) + (0.6806995451 * green) + (0.1073969566 * blue));
    const coneS = Math.cbrt((0.0883024619 * red) + (0.2817188376 * green) + (0.6299787005 * blue));

    const labL = (0.2104542553 * coneL) + (0.7936177850 * coneM) - (0.0040720468 * coneS);
    const labA = (1.9779984951 * coneL) - (2.4285922050 * coneM) + (0.4505937099 * coneS);
    const labB = (0.0259040371 * coneL) + (0.7827717662 * coneM) - (0.8086757660 * coneS);

    return { lightness: labL, chroma: Math.hypot(labA, labB), hue: Math.atan2(labB, labA) };
}

// The linear-RGB triple for an OKLCH color; values outside [0, 1] mean the color escapes the sRGB gamut.
function oklchToLinear(color : Oklch) : [ number, number, number ]
{
    const labA = color.chroma * Math.cos(color.hue);
    const labB = color.chroma * Math.sin(color.hue);

    const coneL = (color.lightness + (0.3963377774 * labA) + (0.2158037573 * labB)) ** 3;
    const coneM = (color.lightness - (0.1055613458 * labA) - (0.0638541728 * labB)) ** 3;
    const coneS = (color.lightness - (0.0894841775 * labA) - (1.2914855480 * labB)) ** 3;

    return [
        (4.0767416621 * coneL) - (3.3077115913 * coneM) + (0.2309699292 * coneS),
        (-1.2684380046 * coneL) + (2.6097574011 * coneM) - (0.3413193965 * coneS),
        (-0.0041960863 * coneL) - (0.7034186147 * coneM) + (1.7076147010 * coneS),
    ];
}

const GAMUT_EPSILON = 0.000001;

function inGamut(linear : [ number, number, number ]) : boolean
{
    return linear.every((channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON);
}

// Chroma is the sacrificial axis: lightness and hue carry the ramp's identity, so an out-of-gamut shade walks its
// chroma down (binary search) until sRGB can express it.
function oklchToHex(color : Oklch) : string
{
    let candidate = color;

    if(!inGamut(oklchToLinear(candidate)))
    {
        let low = 0;
        let high = color.chroma;

        for(let i = 0; i < 20; i++)
        {
            const mid = (low + high) / 2;
            if(inGamut(oklchToLinear({ ...color, chroma: mid }))) { low = mid; }
            else { high = mid; }
        }

        candidate = { ...color, chroma: low };
    }

    const hex = oklchToLinear(candidate)
        .map((channel) => Math.min(1, Math.max(0, channel)))
        .map(linearToSrgb)
        .map((channel) => Math.round(channel * 255).toString(16)
            .padStart(2, '0'))
        .join('');

    return `#${ hex }`;
}

//----------------------------------------------------------------------------------------------------------------------
// The ramp
//----------------------------------------------------------------------------------------------------------------------

// Standard lightness anchors, averaged from Tailwind's own palettes. The picked color replaces the 500 anchor and
// the rest of its side of the curve is re-interpolated through it, so the endpoints stay stable no matter how
// light or dark the pick is.
const LIGHTNESS_ANCHORS : Record<ShadeKey, number> = {
    50: 0.985,
    100: 0.955,
    200: 0.91,
    300: 0.85,
    400: 0.75,
    500: 0.65,
    600: 0.57,
    700: 0.5,
    800: 0.42,
    900: 0.37,
    950: 0.28,
};

// Chroma tapers toward both ends of the ramp, as saturation does in every hand-built palette.
const CHROMA_FACTORS : Record<ShadeKey, number> = {
    50: 0.08,
    100: 0.16,
    200: 0.32,
    300: 0.56,
    400: 0.84,
    500: 1,
    600: 1,
    700: 0.94,
    800: 0.84,
    900: 0.7,
    950: 0.52,
};

export function colorRamp(hex : string) : ColorRamp
{
    const anchor = hexToOklch(hex);

    // Degenerate picks (near-white, near-black) must still produce an ordered ramp, so the endpoints yield to
    // the anchor when it escapes them.
    const top = Math.max(LIGHTNESS_ANCHORS['50'], Math.min(anchor.lightness + 0.01, 0.995));
    const bottom = Math.min(LIGHTNESS_ANCHORS['950'], Math.max(anchor.lightness - 0.01, 0.05));

    const entries = shadeKeys.map((shade) : [ ShadeKey, string ] =>
    {
        if(shade === '500') { return [ shade, hex.trim().toLowerCase() ]; }

        const standard = LIGHTNESS_ANCHORS[shade];
        const reference = LIGHTNESS_ANCHORS['500'];

        const lightness = standard > reference
            ? anchor.lightness
                + (((standard - reference) / (LIGHTNESS_ANCHORS['50'] - reference)) * (top - anchor.lightness))
            : anchor.lightness
                + (((standard - reference) / (LIGHTNESS_ANCHORS['950'] - reference)) * (bottom - anchor.lightness));

        return [ shade, oklchToHex({
            lightness,
            chroma: anchor.chroma * CHROMA_FACTORS[shade],
            hue: anchor.hue,
        }) ];
    });

    return Object.fromEntries(entries) as ColorRamp;
}

// A theme token's value as a hex color: hex passes through lowercased, an oklch() string (the form Tailwind's
// own palettes use) converts through the same math as the ramp, anything else is null. CSS oklch lightness may
// be a percentage or a fraction, and an achromatic hue is the keyword none.
export function themeColorToHex(value : string) : string | null
{
    const trimmed = value.trim();
    if(/^#[0-9a-f]{6}$/i.test(trimmed)) { return trimmed.toLowerCase(); }

    const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+|none)\s*\)$/i.exec(trimmed);
    if(match === null) { return null; }

    const lightness = Number(match[1]) / (match[2] === '%' ? 100 : 1);
    const hue = match[4]?.toLowerCase() === 'none' ? 0 : (Number(match[4]) * Math.PI) / 180;

    return oklchToHex({ lightness, chroma: Number(match[3]), hue });
}

//----------------------------------------------------------------------------------------------------------------------
// Contrast
//----------------------------------------------------------------------------------------------------------------------

// WCAG 2.x contrast ratio, 1 (identical) to 21 (black on white). The UI uses this to warn when text on the
// picked brand color falls below readable.
export function contrastRatio(hexA : string, hexB : string) : number
{
    const luminance = (hex : string) : number =>
    {
        const parsed = parseHexColor(hex);
        if(parsed === null) { throw new Error(`'${ hex }' is not a #rrggbb color.`); }

        const [ red, green, blue ] = parsed.map(srgbToLinear) as [ number, number, number ];
        return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
    };

    const lighter = Math.max(luminance(hexA), luminance(hexB));
    const darker = Math.min(luminance(hexA), luminance(hexB));

    return (lighter + 0.05) / (darker + 0.05);
}

//----------------------------------------------------------------------------------------------------------------------
