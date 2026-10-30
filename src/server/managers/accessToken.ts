//----------------------------------------------------------------------------------------------------------------------
// Access Token Manager
//
// The api-key plugin's HTTP endpoints are blocked externally (clients/http/middleware/authGate.ts), so keys are
// minted, listed, and revoked only through this manager, after our own session check has vouched for the caller.
//
// Two key kinds, two configIds, one table. PATs are the durable user-managed kind; every read here filters to the
// pat config so playback keys -- the media player's short-lived system-minted kind -- never appear in a list a user
// manages.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    ACCESS_TOKEN_CONFIG_PAT,
    ACCESS_TOKEN_CONFIG_PLAYBACK,
    type AccessToken,
    type AccessTokenListResponse,
    BadRequestError,
    type CreateAccessTokenRequest,
    type CreateAccessTokenResponse,
    MAX_ACCESS_TOKENS_PER_USER,
    NotFoundError,
    type PlaybackTokenResponse,
    scopeStatements,
    scopesFromStatement,
    statementForScopes,
    toAccessTokenListResponse,
    toCreateAccessTokenResponse,
    toPlaybackTokenResponse,
} from '@fileshed/core';

// Resource Access
import type { AccessKey, AuthRA } from '../resource-access/auth/index.ts';
import type { SessionUser } from '../resource-access/auth/instance.ts';

//----------------------------------------------------------------------------------------------------------------------

const SECONDS_PER_DAY = 86_400;

//----------------------------------------------------------------------------------------------------------------------

function toAccessToken(key : AccessKey, name : string) : AccessToken
{
    return {
        id: key.id,
        name,
        start: key.start,
        scopes: scopesFromStatement(key.permissions),
        created: key.created,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
    };
}

//----------------------------------------------------------------------------------------------------------------------

export class AccessTokenManager
{
    readonly #auth : AuthRA;

    constructor(auth : AuthRA)
    {
        this.#auth = auth;
    }

    // The cap counts what the caller's own listing shows -- their live PATs -- so "you hold the maximum" and "your list
    // is full" are the same statement, and revoking one always makes room. The count comes from the session-shaped
    // list, which is why the route's headers ride here as well as the actor the session gate already vouched for.
    async create(user : SessionUser, headers : Headers, request : CreateAccessTokenRequest)
    : Promise<CreateAccessTokenResponse>
    {
        const held = await this.#auth.listKeys(headers, ACCESS_TOKEN_CONFIG_PAT);
        if(held.length >= MAX_ACCESS_TOKENS_PER_USER)
        {
            throw new BadRequestError(
                `You already hold the maximum of ${ MAX_ACCESS_TOKENS_PER_USER } access tokens. `
                + 'Revoke one to mint another.'
            );
        }

        const created = await this.#auth.createKey({
            configID: ACCESS_TOKEN_CONFIG_PAT,
            userID: user.id,
            name: request.name,
            permissions: statementForScopes(request.scopes),
            ...(request.expiresInDays === null ? {} : { expiresInSeconds: request.expiresInDays * SECONDS_PER_DAY }),
        });

        return toCreateAccessTokenResponse({
            token: created.token,
            accessToken: toAccessToken(created.key, created.key.name ?? request.name),
        });
    }

    // The caller's PATs, newest first. The plugin's list is session-shaped, so the route's own headers ride along;
    // the config filter is what keeps playback keys out of a surface users manage.
    async list(headers : Headers) : Promise<AccessTokenListResponse>
    {
        const keys = await this.#auth.listKeys(headers, ACCESS_TOKEN_CONFIG_PAT);

        return toAccessTokenListResponse(keys
            .map((key) => toAccessToken(key, key.name ?? ''))
            .sort((first, second) => second.created.getTime() - first.created.getTime()));
    }

    // Revocation is deletion -- a PAT row gone is a credential dead. The plugin scopes the delete to the session
    // user, so one user cannot revoke another's key; a key it cannot see reads as absent.
    async revoke(headers : Headers, keyID : string) : Promise<void>
    {
        if(!await this.#auth.deleteKey(headers, keyID, ACCESS_TOKEN_CONFIG_PAT))
        {
            throw new NotFoundError('No such access token.');
        }
    }

    // The media player's short-lived download-scoped key. Expiry comes from the playback config's default alone.
    // The predecessor delete is best-effort: an already-expired-and-reaped key is success, not an error.
    async mintPlayback(user : SessionUser, headers : Headers, previousID : string | null)
    : Promise<PlaybackTokenResponse>
    {
        if(previousID !== null)
        {
            await this.#auth.deleteKey(headers, previousID, ACCESS_TOKEN_CONFIG_PLAYBACK);
        }

        const created = await this.#auth.createKey({
            configID: ACCESS_TOKEN_CONFIG_PLAYBACK,
            userID: user.id,
            permissions: scopeStatements['files:download'],
        });

        if(created.key.expiresAt === null)
        {
            throw new Error('Playback key minted without the config-default expiry.');
        }

        return toPlaybackTokenResponse({ id: created.key.id, token: created.token, expiresAt: created.key.expiresAt });
    }
}

//----------------------------------------------------------------------------------------------------------------------
