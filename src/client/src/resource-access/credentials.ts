//----------------------------------------------------------------------------------------------------------------------
// Credentials Resource Access
//
// The typed client for the account's own sign-out-everywhere. It answers 204 and kills the very session that sent it,
// so nothing here refetches afterwards -- the caller drops its signed-in state and navigates to sign-in.
//----------------------------------------------------------------------------------------------------------------------

// Resource Access
import { requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export async function revokeAllCredentials() : Promise<void>
{
    return requestVoid('/api/me/revoke-credentials', { method: 'POST' });
}

//----------------------------------------------------------------------------------------------------------------------
