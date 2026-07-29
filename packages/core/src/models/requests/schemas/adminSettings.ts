//----------------------------------------------------------------------------------------------------------------------
// Admin Settings API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Models
import { adminSettingKeys, settingKinds } from '../../instanceSettings.ts';

// Requests
import {
    type AdminSettingsResponse,
    type PatchSettingsRequest,
} from '../adminSettings.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

const settingValueCodec = z.union([ z.number(), z.boolean(), z.string() ]);

export const adminSettingEntryCodec = z.strictObject({
    key: z.enum(adminSettingKeys),
    kind: z.enum(settingKinds),
    secret: z.boolean(),
    requiresRestart: z.boolean(),
    value: settingValueCodec.nullable(),
    source: z.enum([ 'default', 'override' ]),
    hasDefault: z.boolean(),
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
