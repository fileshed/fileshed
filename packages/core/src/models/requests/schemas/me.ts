//----------------------------------------------------------------------------------------------------------------------
// Me API Codec
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import { EDITOR_THEME_MAX_LENGTH, ROOT_LABEL_MAX_LENGTH } from '../../../constants/preferences.ts';

// Models
import { timeFormats } from '../../userPreferences.ts';
import { userRoles } from '../../userProfile.ts';

// Model Schemas
import { userPreferencesCodec } from '../../schemas/userPreferences.ts';

// Requests
import type { MeResponse, UpdatePreferencesRequest } from '../me.ts';

// Request Schemas
import { isoDateTimeCodec } from './common.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const meResponseCodec = z.strictObject({
    id: z.string(),
    email: z.string(),
    name: z.string().optional(),
    role: z.enum(userRoles),
    quota: z.strictObject({
        used: z.number()
            .int()
            .nonnegative(),
        limit: z.number()
            .int()
            .nonnegative()
            .nullable(),
    }),
    preferences: userPreferencesCodec.default({}),
    image: z.string()
        .nullable()
        .optional(),
    createdAt: isoDateTimeCodec,
});

typeAssert<Equals<z.output<typeof meResponseCodec>, MeResponse>>();

//----------------------------------------------------------------------------------------------------------------------

// Loose by design: rootLabel (and its null delete) are validated, but unknown keys pass through untouched so a
// forward-compat preference survives the patch instead of being stripped. See UpdatePreferencesRequest.
export const updatePreferencesRequestCodec = z.looseObject({
    rootLabel: z.string()
        .trim()
        .min(1)
        .max(ROOT_LABEL_MAX_LENGTH)
        .nullable()
        .optional(),
    timeFormat: z.enum(timeFormats)
        .nullable()
        .optional(),
    editorTheme: z.string()
        .trim()
        .min(1)
        .max(EDITOR_THEME_MAX_LENGTH)
        .nullable()
        .optional(),
    editorGutter: z.boolean()
        .nullable()
        .optional(),
});

typeAssert<Equals<z.output<typeof updatePreferencesRequestCodec>, UpdatePreferencesRequest>>();

//----------------------------------------------------------------------------------------------------------------------
