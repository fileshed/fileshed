//----------------------------------------------------------------------------------------------------------------------
// Setup API Codecs
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

// Requests
import { type InstanceResponse, type SetupRequest, type SetupResponse } from '../setup.ts';

// Utils
import { type Equals, typeAssert } from '../../../utils/typeAssert.ts';

//----------------------------------------------------------------------------------------------------------------------

export const instanceResponseCodec = z.strictObject({
    needsSetup: z.boolean(),
    signUpEnabled: z.boolean(),
    emailEnabled: z.boolean(),
});

typeAssert<Equals<z.output<typeof instanceResponseCodec>, InstanceResponse>>();

// The password floor matches better-auth's own sign-up minimum; the token is opaque and only ever compared, so no
// shape is imposed beyond presence.
export const setupRequestCodec = z.strictObject({
    token: z.string().min(1),
    name: z.string().trim()
        .min(1)
        .max(100),
    email: z.string().trim()
        .min(3)
        .max(254),
    password: z.string().min(8),
});

typeAssert<Equals<z.output<typeof setupRequestCodec>, SetupRequest>>();

export const setupResponseCodec = z.strictObject({
    email: z.string(),
});

typeAssert<Equals<z.output<typeof setupResponseCodec>, SetupResponse>>();

//----------------------------------------------------------------------------------------------------------------------
