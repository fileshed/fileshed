//----------------------------------------------------------------------------------------------------------------------
// Instance Theme Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { CUSTOM_CSS_MAX_LENGTH, THEME_RADIUS_MAX } from '../../constants/branding.ts';

// Models
import { type InstanceTheme, colorModes, neutralFamilies } from '../instanceTheme.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

// Lowercased at the boundary so every stored and echoed hex has one spelling -- the client's dirty diff and the
// hex input's blur handling both depend on never meeting #FF8800 and #ff8800 as different values.
export const hexColorCodec = z.string()
    .regex(/^#[0-9a-f]{6}$/i, 'must be a #rrggbb color')
    .transform((value) => value.toLowerCase());

// The wire is loose -- an absent field means unset -- but the parsed document is the full canonical shape, so
// every consumer downstream reasons about a complete theme.
export const instanceThemeCodec = z.object({
    primary: hexColorCodec.nullable().default(null),
    secondary: hexColorCodec.nullable().default(null),
    neutral: z.enum(neutralFamilies).nullable()
        .default(null),
    radius: z.number()
        .min(0)
        .max(THEME_RADIUS_MAX)
        .nullable()
        .default(null),
    mode: z.enum(colorModes).default('system'),
    forcedMode: z.boolean().default(false),
    customCSS: z.string()
        .max(CUSTOM_CSS_MAX_LENGTH)
        .nullable()
        .default(null),
});

typeAssert<Equals<z.output<typeof instanceThemeCodec>, InstanceTheme>>();

// The known view of an arbitrary stored document: unknown keys are dropped from the VIEW but stay in storage
// (the server merges key-wise), and a malformed document collapses to the stock theme rather than failing the
// read -- the instance must render even if someone hand-edited the row.
export function toInstanceTheme(raw : unknown) : InstanceTheme
{
    const parsed = instanceThemeCodec.safeParse(raw);
    return parsed.success ? parsed.data : instanceThemeCodec.parse({});
}

//----------------------------------------------------------------------------------------------------------------------
