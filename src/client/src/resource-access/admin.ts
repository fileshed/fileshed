//----------------------------------------------------------------------------------------------------------------------
// Admin Resource Access
//
// The typed client for the admin surface: list users, set (or clear) a user's quota, read the server status, and
// read or patch the instance settings.
//----------------------------------------------------------------------------------------------------------------------

import {
    type AdminSettingsResponse,
    type AdminStatusResponse,
    type AdminUserPageResponse,
    type AdminUserResponse,
    type PatchSettingsRequest,
    type SetQuotaRequest,
    adminSettingsResponseCodec,
    adminStatusResponseCodec,
    adminUserPageResponseCodec,
    adminUserResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJson } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface ListUsersPagination
{
    limit ?: number;
    offset ?: number;
}

//----------------------------------------------------------------------------------------------------------------------

export async function listUsers(pagination : ListUsersPagination = {}) : Promise<AdminUserPageResponse>
{
    return requestJson('/api/admin/users', {
        query: { limit: pagination.limit, offset: pagination.offset },
        codec: adminUserPageResponseCodec,
    });
}

export async function setQuota(userID : string, quotaLimit : number | null) : Promise<AdminUserResponse>
{
    const body : SetQuotaRequest = { quotaLimit };

    return requestJson(`/api/admin/users/${ userID }`, { method: 'PATCH', body, codec: adminUserResponseCodec });
}

export async function adminStatus() : Promise<AdminStatusResponse>
{
    return requestJson('/api/admin/status', { codec: adminStatusResponseCodec });
}

export async function fetchAdminSettings() : Promise<AdminSettingsResponse>
{
    return requestJson('/api/admin/settings', { codec: adminSettingsResponseCodec });
}

export async function patchAdminSettings(changes : PatchSettingsRequest['changes']) : Promise<AdminSettingsResponse>
{
    const body : PatchSettingsRequest = { changes };

    return requestJson('/api/admin/settings', { method: 'PATCH', body, codec: adminSettingsResponseCodec });
}

//----------------------------------------------------------------------------------------------------------------------
