//----------------------------------------------------------------------------------------------------------------------
// Branding API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { CUSTOM_CSS_MAX_LENGTH, THEME_RADIUS_MAX } from '../../../constants/branding.ts';

// Models
import { colorModes, neutralFamilies } from '../../instanceTheme.ts';
import { hexColorCodec } from '../../schemas/instanceTheme.ts';

// Requests
import type { UpdateBrandingRequest } from '../branding.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

// Strict on purpose: a misspelled field in a PATCH is a bug to surface, not an unknown key to preserve --
// preservation is a property of the STORED document, enforced by the server's key-wise merge.
export const updateBrandingRequestCodec = z.strictObject({
    primary: hexColorCodec.nullable().optional(),
    secondary: hexColorCodec.nullable().optional(),
    neutral: z.enum(neutralFamilies).nullable()
        .optional(),
    radius: z.number()
        .min(0)
        .max(THEME_RADIUS_MAX)
        .nullable()
        .optional(),
    mode: z.enum(colorModes).optional(),
    forcedMode: z.boolean().optional(),
    customCSS: z.string()
        .max(CUSTOM_CSS_MAX_LENGTH)
        .nullable()
        .optional(),
});

typeAssert<Equals<z.output<typeof updateBrandingRequestCodec>, UpdateBrandingRequest>>();

//----------------------------------------------------------------------------------------------------------------------
