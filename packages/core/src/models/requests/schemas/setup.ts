//----------------------------------------------------------------------------------------------------------------------
// Setup API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Constants
import {
    DISPLAY_NAME_MAX_LENGTH,
    EMAIL_MAX_LENGTH,
    EMAIL_MIN_LENGTH,
    PASSWORD_MIN_LENGTH,
} from '../../../constants/user.ts';

// Models
import { colorModes } from '../../instanceTheme.ts';
import { socialProviderIDs } from '../../instanceSettings.ts';

// Requests
import { type InstanceResponse, type SetupRequest, type SetupResponse } from '../setup.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const instanceResponseCodec = z.strictObject({
    needsSetup: z.boolean(),
    signUpEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    providers: z.array(z.enum(socialProviderIDs)),
    branding: z.strictObject({
        instanceName: z.string(),
        mode: z.enum(colorModes),
        forcedMode: z.boolean(),
        logo: z.string().nullable(),
    }),
    limits: z.strictObject({
        uploadMaxBytes: z.number()
            .int()
            .positive(),
        avatarMaxBytes: z.number()
            .int()
            .positive(),
    }),
});

typeAssert<Equals<z.output<typeof instanceResponseCodec>, InstanceResponse>>();

// The token is opaque and only ever compared, so no shape is imposed beyond presence.
export const setupRequestCodec = z.strictObject({
    token: z.string().min(1),
    name: z.string().trim()
        .min(1)
        .max(DISPLAY_NAME_MAX_LENGTH),
    email: z.string().trim()
        .min(EMAIL_MIN_LENGTH)
        .max(EMAIL_MAX_LENGTH),
    password: z.string().min(PASSWORD_MIN_LENGTH),
});

typeAssert<Equals<z.output<typeof setupRequestCodec>, SetupRequest>>();

export const setupResponseCodec = z.strictObject({
    email: z.string(),
});

typeAssert<Equals<z.output<typeof setupResponseCodec>, SetupResponse>>();

//----------------------------------------------------------------------------------------------------------------------
