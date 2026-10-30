//----------------------------------------------------------------------------------------------------------------------
// Auth Resource Access
//
// Every better-auth call a manager makes goes through this class, and better-auth's APIError does not leave it: a
// refusal becomes the core error for its status, or null/false where it only means the thing is not there. A failure
// on better-auth's side (5xx) is rethrown as it came, for the logged 500.
//----------------------------------------------------------------------------------------------------------------------

import { isAPIError } from 'better-auth/api';

// Models
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    type PermissionStatement,
    TooManyRequestsError,
    UnauthorizedError,
    type UserRole,
} from '@fileshed/core';

// Resource Access
import type { DatabaseHandle } from '../database/database.ts';
import { type Auth, type SessionUser, deleteAccessTokensFor, deletePendingAccountActionsFor } from './instance.ts';

//----------------------------------------------------------------------------------------------------------------------

// The admin plugin types a mutation's result as UserWithRole, which does not statically carry app-level
// additionalFields; quota_limit is present at runtime (it is a real column), so the type is widened to admit it.
export type AdminUser = Awaited<ReturnType<Auth['api']['banUser']>>['user'] & { quotaLimit ?: number | null };

export interface AccessKey
{
    id : string;
    name : string | null;
    start : string | null;
    permissions : PermissionStatement;
    createdAt : Date;
    lastUsedAt : Date | null;
    expiresAt : Date | null;
}

export interface KeyRequest
{
    configID : string;
    userID : string;
    name ?: string;
    permissions : PermissionStatement;

    // Absent takes the config's default expiry, which for a PAT is none.
    expiresInSeconds ?: number;
}

export interface MintedKey
{
    token : string;
    key : AccessKey;
}

export interface VerifiedKey
{
    userID : string;
    permissions : PermissionStatement;
}

export interface BanTerms
{
    reason ?: string;
    expiresInSeconds ?: number;
}

export interface NewAccount
{
    email : string;
    name : string;
    password : string;
}

//----------------------------------------------------------------------------------------------------------------------

function refusalFor(error : unknown, missing ?: string) : Error | null
{
    if(!isAPIError(error)) { return null; }

    const message = error.message || 'The request was refused.';
    switch (error.statusCode)
    {
        case 400:
        case 422:
            return new BadRequestError(message);
        case 401:
            return new UnauthorizedError(message);
        case 403:
            return new ForbiddenError(message);
        case 404:
            return new NotFoundError(missing ?? message);
        case 429:
            return new TooManyRequestsError(message);
        default:
            return null;
    }
}

async function translated<T>(work : () => Promise<T>, missing ?: string) : Promise<T>
{
    try
    {
        return await work();
    }
    catch(error)
    {
        throw refusalFor(error, missing) ?? error;
    }
}

// The plugin stores permissions as a JSON text column; depending on the call a key record arrives with them as a
// parsed record, a raw string, or null. Everything downstream wants the record.
function permissionsOf(stored : PermissionStatement | string | null | undefined) : PermissionStatement
{
    if(stored === null || stored === undefined) { return {}; }
    if(typeof stored !== 'string') { return stored; }

    try
    {
        const parsed : unknown = JSON.parse(stored);
        if(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
        {
            return parsed as PermissionStatement;
        }
    }
    catch { /* fall through to no permissions, which satisfies no demand */ }

    return {};
}

//----------------------------------------------------------------------------------------------------------------------

export class AuthRA
{
    readonly #auth : Auth;
    readonly #handle : DatabaseHandle;

    constructor(auth : Auth, handle : DatabaseHandle)
    {
        this.#auth = auth;
        this.#handle = handle;
    }

    //------------------------------------------------------------------------------------------------------------------
    // Sessions and accounts
    //------------------------------------------------------------------------------------------------------------------

    async sessionUser(headers : Headers) : Promise<SessionUser | null>
    {
        const session = await translated(() => this.#auth.api.getSession({ headers }));

        return session?.user ?? null;
    }

    // Read through better-auth's own adapter, so the row carries every field its session user does.
    async findUser(userID : string) : Promise<SessionUser | null>
    {
        const context = await this.#auth.$context;
        const user = await context.internalAdapter.findUserById(userID);

        return user === null ? null : user as SessionUser;
    }

    async signUp(account : NewAccount) : Promise<{ id : string; email : string }>
    {
        const { user } = await translated(() => this.#auth.api.signUpEmail({ body: account }));

        return { id: user.id, email: user.email };
    }

    // The caller's own sessions, the one these headers carry included.
    async revokeOwnSessions(headers : Headers) : Promise<void>
    {
        await translated(() => this.#auth.api.revokeSessions({ headers }));
    }

    // Straight through the adapter, with no session deciding: a deletion falling due on a timer has none.
    async deleteUserSessions(userID : string) : Promise<void>
    {
        const context = await this.#auth.$context;
        await context.internalAdapter.deleteUserSessions(userID);
    }

    // Fires better-auth's own hooks, which take the account's access tokens with it.
    async deleteUser(userID : string) : Promise<void>
    {
        const context = await this.#auth.$context;
        await context.internalAdapter.deleteUser(userID);
    }

    async deleteAccessTokens(userID : string) : Promise<void>
    {
        await deleteAccessTokensFor(this.#handle, userID);
    }

    async deletePendingAccountActions(userID : string) : Promise<void>
    {
        await deletePendingAccountActionsFor(this.#handle, userID);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Access keys
    //------------------------------------------------------------------------------------------------------------------

    // Headerless with an explicit userId: the plugin refuses server-only properties (permissions among them) from any
    // call carrying a request, so the caller's own session gate is what vouches for the user. rateLimitEnabled:false
    // is set on every key, so no plugin or schema default can rate-cap a deployment's own credentials.
    async createKey(request : KeyRequest) : Promise<MintedKey>
    {
        const created = await translated(() => this.#auth.api.createApiKey({
            body: {
                configId: request.configID,
                userId: request.userID,
                ...(request.name === undefined ? {} : { name: request.name }),
                permissions: request.permissions,
                rateLimitEnabled: false,
                ...(request.expiresInSeconds === undefined ? {} : { expiresIn: request.expiresInSeconds }),
            },
        }));

        return {
            token: created.key,
            key: {
                id: created.id,
                name: created.name ?? null,
                start: created.start ?? null,
                permissions: permissionsOf(created.permissions),
                createdAt: created.createdAt,
                lastUsedAt: null,
                expiresAt: created.expiresAt ?? null,
            },
        };
    }

    // The session user's keys of one config. The plugin's list is session-shaped, so the caller's headers ride along.
    async listKeys(headers : Headers, configID : string) : Promise<AccessKey[]>
    {
        const result = await translated(() => this.#auth.api.listApiKeys({ headers, query: { configId: configID } }));

        return result.apiKeys.map((key) => ({
            id: key.id,
            name: key.name ?? null,
            start: key.start ?? null,
            permissions: permissionsOf(key.permissions),
            createdAt: key.createdAt,
            lastUsedAt: key.lastRequest ?? null,
            expiresAt: key.expiresAt ?? null,
        }));
    }

    // False when the session user holds no such key: the plugin scopes the delete to them, so another account's key
    // reads as absent rather than forbidden.
    async deleteKey(headers : Headers, keyID : string, configID : string) : Promise<boolean>
    {
        try
        {
            await translated(() => this.#auth.api.deleteApiKey({
                headers,
                body: { keyId: keyID, configId: configID },
            }));

            return true;
        }
        catch(error)
        {
            if(error instanceof NotFoundError) { return false; }
            throw error;
        }
    }

    // Null for any key the plugin will not vouch for, under-scoped for `required` included -- every 4xx it answers a
    // verify with means the same thing to the caller. One plugin call, never getSession, which would count the key's
    // use twice.
    async verifyKey(token : string, configID : string, required ?: PermissionStatement) : Promise<VerifiedKey | null>
    {
        let result;
        try
        {
            result = await this.#auth.api.verifyApiKey({
                body: { key: token, configId: configID, ...(required ? { permissions: required } : {}) },
            });
        }
        catch(error)
        {
            if(isAPIError(error) && error.statusCode < 500) { return null; }
            throw error;
        }

        if(!result.valid || !result.key) { return null; }

        return { userID: result.key.referenceId, permissions: result.key.permissions ?? {} };
    }

    //------------------------------------------------------------------------------------------------------------------
    // Admin mutations
    //
    // The admin plugin's endpoints, called in-process with the admin's own headers: the plugin re-checks that session
    // and owns the side effects a ban or a role change drags along. An unknown user id is a NotFoundError naming it.
    //------------------------------------------------------------------------------------------------------------------

    async setQuota(headers : Headers, userID : string, quotaLimit : number | null) : Promise<AdminUser>
    {
        return translated(
            () => this.#auth.api.adminUpdateUser({ body: { userId: userID, data: { quotaLimit } }, headers }),
            `No user ${ userID }.`
        );
    }

    async ban(headers : Headers, userID : string, terms : BanTerms) : Promise<AdminUser>
    {
        const { user } = await translated(() => this.#auth.api.banUser({
            body: {
                userId: userID,
                ...(terms.reason === undefined ? {} : { banReason: terms.reason }),
                ...(terms.expiresInSeconds === undefined ? {} : { banExpiresIn: terms.expiresInSeconds }),
            },
            headers,
        }), `No user ${ userID }.`);

        return user;
    }

    async unban(headers : Headers, userID : string) : Promise<AdminUser>
    {
        const { user } = await translated(
            () => this.#auth.api.unbanUser({ body: { userId: userID }, headers }),
            `No user ${ userID }.`
        );

        return user;
    }

    async setRole(headers : Headers, userID : string, role : UserRole) : Promise<AdminUser>
    {
        const { user } = await translated(
            () => this.#auth.api.setRole({ body: { userId: userID, role }, headers }),
            `No user ${ userID }.`
        );

        return user;
    }

    async setPassword(headers : Headers, userID : string, password : string) : Promise<void>
    {
        await translated(
            () => this.#auth.api.setUserPassword({ body: { userId: userID, newPassword: password }, headers }),
            `No user ${ userID }.`
        );
    }

    async revokeUserSessions(headers : Headers, userID : string) : Promise<void>
    {
        await translated(
            () => this.#auth.api.revokeUserSessions({ body: { userId: userID }, headers }),
            `No user ${ userID }.`
        );
    }
}

//----------------------------------------------------------------------------------------------------------------------
