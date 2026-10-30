//----------------------------------------------------------------------------------------------------------------------
// Credentials Resource Access
//
// Signing out everywhere also ends the session that sent the request, so nothing here refetches; the caller drops its
// signed-in state and navigates to sign-in.
//----------------------------------------------------------------------------------------------------------------------

// Resource Access
import { requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function revokeAllCredentials() : Promise<void>
{
    return requestVoid('/api/me/revoke-credentials', { method: 'POST' });
}

//----------------------------------------------------------------------------------------------------------------------
