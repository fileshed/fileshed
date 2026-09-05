//----------------------------------------------------------------------------------------------------------------------
// User Preferences Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { EDITOR_THEME_MAX_LENGTH, ROOT_LABEL_MAX_LENGTH } from '../../constants/preferences.ts';

// Models
import { type UserPreferences, timeFormats, viewModes } from '../userPreferences.ts';
import { colorModes } from '../instanceTheme.ts';

// Utils
import { type Equals, typeAssert } from '../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const userPreferencesCodec = z.object({
    rootLabel: z.string()
        .trim()
        .min(1)
        .max(ROOT_LABEL_MAX_LENGTH)
        .optional(),
    timeFormat: z.enum(timeFormats).optional(),
    editorTheme: z.string()
        .trim()
        .min(1)
        .max(EDITOR_THEME_MAX_LENGTH)
        .optional(),
    editorGutter: z.boolean().optional(),
    viewMode: z.enum(viewModes).optional(),
    colorMode: z.enum(colorModes).optional(),
    allowRemoteMedia: z.boolean().optional(),
});

typeAssert<Equals<z.output<typeof userPreferencesCodec>, UserPreferences>>();

//----------------------------------------------------------------------------------------------------------------------

// The known view of an arbitrary stored blob: known keys validated, unknown keys dropped (they stay in storage), a
// malformed known value collapsing to the default rather than throwing. This is the read side of the preferences
// contract -- the server never lets a hand-edited or future-versioned blob fail a profile read.
export function toUserPreferences(raw : Record<string, unknown>) : UserPreferences
{
    const parsed = userPreferencesCodec.safeParse(raw);
    return parsed.success ? parsed.data : {};
}

//----------------------------------------------------------------------------------------------------------------------
