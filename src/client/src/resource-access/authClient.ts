//----------------------------------------------------------------------------------------------------------------------
// Auth Client
//
// No baseURL: the client is served from the same origin as the API, so it talks to /api/auth/* on the current host. No
// adminClient(): the better-auth admin HTTP surface is blocked server-side, and admin operations go through FileShed's
// own /api/admin/* routes.
//----------------------------------------------------------------------------------------------------------------------

import { createAuthClient } from 'better-auth/vue';

//----------------------------------------------------------------------------------------------------------------------

export const authClient = createAuthClient();

//----------------------------------------------------------------------------------------------------------------------
