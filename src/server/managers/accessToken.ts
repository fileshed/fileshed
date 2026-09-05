//----------------------------------------------------------------------------------------------------------------------
// Access Token Manager
//
// The business layer behind /api/me/access-tokens and /api/me/playback-token. The api-key plugin's HTTP endpoints
// are blocked externally (app.ts), so keys are minted, listed, and revoked exclusively through this manager's
// in-process auth.api.* calls -- which is also what makes SCOPED creation possible at all: the plugin refuses
// permissions from any request carrying headers, so the create call goes headerless with an explicit userId after
// our own session gate has vouched for the caller.
//
// Two key kinds, two configIds, one table. PATs are the durable user-managed kind; every read here filters to the
// pat config so playback keys -- the media player's short-lived system-minted kind -- never appear in a list a user
// manages. rateLimitEnabled:false is stamped per key at mint, so no plugin or schema default can quietly rate-cap
// a self-hosted deployment's own credentials.
//----------------------------------------------------------------------------------------------------------------------

import { isAPIError } from 'better-auth/api';

// Models
import {
    ACCESS_TOKEN_CONFIG_PAT,
    ACCESS_TOKEN_CONFIG_PLAYBACK,
    type AccessToken,
    BadRequestError,
    type CreateAccessTokenRequest,
    MAX_ACCESS_TOKENS_PER_USER,
    NotFoundError,
    type PermissionStatement,
    scopeStatements,
    scopesFromStatement,
    statementForScopes,
} from '@fileshed/core';

// Resource Access
import type { Auth, SessionUser } from '../resource-access/auth.ts';

//----------------------------------------------------------------------------------------------------------------------

const SECONDS_PER_DAY = 86_400;

export interface MintedAccessToken
{
    token : string;
    accessToken : AccessToken;
}

export interface MintedPlaybackToken
{
    id : string;
    token : string;
    expiresAt : Date;
}

//----------------------------------------------------------------------------------------------------------------------

// The plugin stores permissions as a JSON text column; depending on the path a key record arrives with them as a
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

export class AccessTokenManager
{
    readonly #auth : Auth;

    constructor(auth : Auth)
    {
        this.#auth = auth;
    }

    // The cap counts what the caller's own listing shows -- their live PATs -- so "you hold the maximum" and "your list
    // is full" are the same statement, and revoking one always makes room. The count comes from the session-shaped
    // list, which is why the route's headers ride here as well as the actor the session gate already vouched for.
    async create(actor : SessionUser, headers : Headers, request : CreateAccessTokenRequest)
    : Promise<MintedAccessToken>
    {
        const held = await this.list(headers);
        if(held.length >= MAX_ACCESS_TOKENS_PER_USER)
        {
            throw new BadRequestError(
                `You already hold the maximum of ${ MAX_ACCESS_TOKENS_PER_USER } access tokens. `
                + 'Revoke one to mint another.'
            );
        }

        const created = await this.#auth.api.createApiKey({
            body: {
                configId: ACCESS_TOKEN_CONFIG_PAT,
                userId: actor.id,
                name: request.name,
                permissions: statementForScopes(request.scopes),
                rateLimitEnabled: false,
                ...(request.expiresInDays === null ? {} : { expiresIn: request.expiresInDays * SECONDS_PER_DAY }),
            },
        });

        return {
            token: created.key,
            accessToken: {
                id: created.id,
                name: created.name ?? request.name,
                start: created.start ?? null,
                scopes: scopesFromStatement(permissionsOf(created.permissions)),
                createdAt: created.createdAt,
                lastUsedAt: null,
                expiresAt: created.expiresAt ?? null,
            },
        };
    }

    // The caller's PATs, newest first. The plugin's list is session-shaped, so the route's own headers ride along;
    // the config filter is what keeps playback keys out of a surface users manage.
    async list(headers : Headers) : Promise<AccessToken[]>
    {
        const result = await this.#auth.api.listApiKeys({
            headers,
            query: { configId: ACCESS_TOKEN_CONFIG_PAT },
        });

        return result.apiKeys
            .map((key) => ({
                id: key.id,
                name: key.name ?? '',
                start: key.start ?? null,
                scopes: scopesFromStatement(permissionsOf(key.permissions)),
                createdAt: key.createdAt,
                lastUsedAt: key.lastRequest ?? null,
                expiresAt: key.expiresAt ?? null,
            }))
            .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
    }

    // Revocation is deletion -- a PAT row gone is a credential dead. The plugin scopes the delete to the session
    // user, so one user cannot revoke another's key; a key it cannot see reads as absent.
    async revoke(headers : Headers, keyID : string) : Promise<void>
    {
        try
        {
            await this.#auth.api.deleteApiKey({
                headers,
                body: { keyId: keyID, configId: ACCESS_TOKEN_CONFIG_PAT },
            });
        }
        catch(caught)
        {
            if(isAPIError(caught)) { throw new NotFoundError('No such access token.'); }
            throw caught;
        }
    }

    // The media player's short-lived download-scoped key. Expiry comes from the playback config's default alone.
    // The predecessor delete is best-effort: an already-expired-and-reaped key is success, not an error.
    async mintPlayback(actor : SessionUser, headers : Headers, previousID : string | null)
    : Promise<MintedPlaybackToken>
    {
        if(previousID !== null)
        {
            try
            {
                await this.#auth.api.deleteApiKey({
                    headers,
                    body: { keyId: previousID, configId: ACCESS_TOKEN_CONFIG_PLAYBACK },
                });
            }
            catch(caught)
            {
                if(!isAPIError(caught)) { throw caught; }
            }
        }

        const created = await this.#auth.api.createApiKey({
            body: {
                configId: ACCESS_TOKEN_CONFIG_PLAYBACK,
                userId: actor.id,
                permissions: scopeStatements['files:download'],
                rateLimitEnabled: false,
            },
        });

        if(created.expiresAt === null || created.expiresAt === undefined)
        {
            throw new Error('Playback key minted without the config-default expiry.');
        }

        return { id: created.id, token: created.key, expiresAt: created.expiresAt };
    }
}

//----------------------------------------------------------------------------------------------------------------------
