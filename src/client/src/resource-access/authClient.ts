//----------------------------------------------------------------------------------------------------------------------
// Auth Client
//
// The better-auth Vue client: a reactive session plus the email/password actions the UI will drive. No baseURL -- the
// client is served from the same origin as the API, so it talks to /api/auth/* on the current host.
//
// No adminClient(): the better-auth admin HTTP surface is blocked server-side, and FileShed's admin operations go
// through our own /api/admin/* routes. There is nothing for a client-side admin plugin to call.
//----------------------------------------------------------------------------------------------------------------------

import { createAuthClient } from 'better-auth/vue';

//----------------------------------------------------------------------------------------------------------------------

export const authClient = createAuthClient();

//----------------------------------------------------------------------------------------------------------------------
