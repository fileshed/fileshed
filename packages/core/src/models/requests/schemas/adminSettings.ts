//----------------------------------------------------------------------------------------------------------------------
// Admin Settings API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { type SettingConstraints, adminSettingKeys, settingKinds } from '../../instanceSettings.ts';

// Requests
import {
    type AdminSettingsResponse,
    type PatchSettingsRequest,
} from '../adminSettings.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

const settingValueCodec = z.union([ z.number(), z.boolean(), z.string() ]);

const settingConstraintsCodec = z.strictObject({
    min: z.number().optional(),
    max: z.number().optional(),
    maxLength: z.number().optional(),
});

typeAssert<Equals<z.output<typeof settingConstraintsCodec>, SettingConstraints>>();

export const adminSettingEntryCodec = z.strictObject({
    key: z.enum(adminSettingKeys),
    kind: z.enum(settingKinds),
    secret: z.boolean(),
    requiresRestart: z.boolean(),
    value: settingValueCodec.nullable(),
    source: z.enum([ 'default', 'override' ]),
    hasDefault: z.boolean(),
    constraints: settingConstraintsCodec.optional(),
});

export const adminSettingsResponseCodec = z.strictObject({
    settings: z.array(adminSettingEntryCodec),
    restartRequired: z.boolean(),
});

typeAssert<Equals<z.output<typeof adminSettingsResponseCodec>, AdminSettingsResponse>>();

export const patchSettingsRequestCodec = z.strictObject({
    changes: z.partialRecord(z.enum(adminSettingKeys), settingValueCodec.nullable()),
});

typeAssert<Equals<z.output<typeof patchSettingsRequestCodec>, PatchSettingsRequest>>();

//----------------------------------------------------------------------------------------------------------------------
