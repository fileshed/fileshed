//----------------------------------------------------------------------------------------------------------------------
// Admin Resource Access
//----------------------------------------------------------------------------------------------------------------------

import { z } from 'zod';

import {
    type AdminSettingsResponse,
    type AdminStatusResponse,
    type AdminUserListQuery,
    type AdminUserPageResponse,
    type AdminUserResponse,
    type BanUserRequest,
    type InstanceTheme,
    type PatchSettingsRequest,
    type SetPasswordRequest,
    type SetQuotaRequest,
    type SetRoleRequest,
    type SweepKind,
    type SweepRunResponse,
    type TestEmailResponse,
    type UpdateBrandingRequest,
    type UserRole,
    adminSettingsResponseCodec,
    adminStatusResponseCodec,
    adminUserPageResponseCodec,
    adminUserResponseCodec,
    instanceThemeCodec,
    sweepRunResponseCodec,
    testEmailResponseCodec,
} from '@fileshed/core';

// Resource Access
import { requestJson, requestUpload, requestVoid } from './request.ts';

//----------------------------------------------------------------------------------------------------------------------

// Whatever the caller leaves out takes the server's default.
export async function listUsers(query : Partial<AdminUserListQuery> = {}) : Promise<AdminUserPageResponse>
{
    return requestJson('/api/admin/users', { query: { ...query }, codec: adminUserPageResponseCodec });
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

// Immediate and unrecoverable: the account's files go with it, and the storage behind them is released.
export async function deleteUser(userID : string) : Promise<void>
{
    await requestVoid(`/api/admin/users/${ userID }`, { method: 'DELETE' });
}

export async function sendTestEmail() : Promise<TestEmailResponse>
{
    return requestJson('/api/admin/email/test', { method: 'POST', codec: testEmailResponseCodec });
}

export async function getAdminStatus() : Promise<AdminStatusResponse>
{
    return requestJson('/api/admin/status', { codec: adminStatusResponseCodec });
}

// Resolves only once the sweep has finished, with what it reclaimed. A sweep already running answers 409, which
// surfaces as an ApiError carrying the server's sentence.
export async function runSweep(sweep : SweepKind) : Promise<SweepRunResponse>
{
    return requestJson(`/api/admin/sweeps/${ sweep }/run`, { method: 'POST', codec: sweepRunResponseCodec });
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

export async function fetchBranding() : Promise<InstanceTheme>
{
    return requestJson('/api/admin/branding', { codec: instanceThemeCodec });
}

export async function patchBranding(patch : UpdateBrandingRequest) : Promise<InstanceTheme>
{
    return requestJson('/api/admin/branding', { method: 'PATCH', body: patch, codec: instanceThemeCodec });
}

export async function uploadBrandingLogo(file : File) : Promise<void>
{
    await requestUpload('/api/admin/branding/logo', {
        method: 'POST',
        body: file,
        contentType: file.type,
        codec: z.object({ logo: z.string().nullable() }),
    });
}

export async function deleteBrandingLogo() : Promise<void>
{
    return requestVoid('/api/admin/branding/logo', { method: 'DELETE' });
}

//----------------------------------------------------------------------------------------------------------------------
