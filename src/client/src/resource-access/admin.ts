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
    type AdminUserSearchField,
    type AdminUserSortKey,
    type BanUserRequest,
    type PatchSettingsRequest,
    type SetPasswordRequest,
    type SetQuotaRequest,
    type SetRoleRequest,
    type TestEmailResponse,
    type UserRole,
    adminSettingsResponseCodec,
    adminStatusResponseCodec,
    adminUserPageResponseCodec,
    adminUserResponseCodec,
    testEmailResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJson, requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface ListUsersOptions
{
    limit ?: number;
    offset ?: number;
    search ?: string;
    searchField ?: AdminUserSearchField;
    sortBy ?: AdminUserSortKey;
    sortDirection ?: 'asc' | 'desc';
}

//----------------------------------------------------------------------------------------------------------------------

export async function listUsers(options : ListUsersOptions = {}) : Promise<AdminUserPageResponse>
{
    return requestJson('/api/admin/users', {
        query: {
            limit: options.limit,
            offset: options.offset,
            search: options.search,
            searchField: options.searchField,
            sortBy: options.sortBy,
            sortDirection: options.sortDirection,
        },
        codec: adminUserPageResponseCodec,
    });
}

export async function setQuota(userID : string, quotaLimit : number | null) : Promise<AdminUserResponse>
{
    const body : SetQuotaRequest = { quotaLimit };

    return requestJson(`/api/admin/users/${ userID }`, { method: 'PATCH', body, codec: adminUserResponseCodec });
}

export async function banUser(userID : string, request : BanUserRequest) : Promise<AdminUserResponse>
{
    return requestJson(`/api/admin/users/${ userID }/ban`, {
        method: 'POST',
        body: request,
        codec: adminUserResponseCodec,
    });
}

export async function unbanUser(userID : string) : Promise<AdminUserResponse>
{
    return requestJson(`/api/admin/users/${ userID }/unban`, { method: 'POST', codec: adminUserResponseCodec });
}

export async function setUserRole(userID : string, role : UserRole) : Promise<AdminUserResponse>
{
    const body : SetRoleRequest = { role };

    return requestJson(`/api/admin/users/${ userID }/role`, {
        method: 'POST',
        body,
        codec: adminUserResponseCodec,
    });
}

export async function setUserPassword(userID : string, password : string) : Promise<void>
{
    const body : SetPasswordRequest = { password };

    await requestVoid(`/api/admin/users/${ userID }/password`, { method: 'POST', body });
}

export async function revokeUserSessions(userID : string) : Promise<void>
{
    await requestVoid(`/api/admin/users/${ userID }/revoke-sessions`, { method: 'POST' });
}

export async function sendTestEmail() : Promise<TestEmailResponse>
{
    return requestJson('/api/admin/email/test', { method: 'POST', codec: testEmailResponseCodec });
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
