//----------------------------------------------------------------------------------------------------------------------
// Session Manager
//
// The one identity seam: every authenticated route resolves "who is asking" through this manager rather than
// reaching into the auth resource directly (iDesign layering).
//
// Two credential planes resolve here. requireUser is the session-only plane -- routes with no business accepting
// anything but a signed-in browser (admin, account security, token management itself) stay on it, and tokens simply
// do not exist for them. resolveActor is the wider plane for routes that opted into access tokens: it tries the
// session first (a browser on the media page sends both its cookie and a tokened src URL -- the session wins), then
// a bearer header, then a route-supplied URL token. The credential union's bare-token arm exists for consumers that
// have no Headers at all -- a future FTP/SFTP/WebDAV gateway hands the password field straight in.
//
// Token verification is exactly one plugin call (verifyApiKey with the route's demanded permissions -- never
// getSession, which would double the key's usage accounting), then a user load the plugin does not do itself: keys
// carry no FK to their owner and verification never consults the user row, so banned and deleted owners are
// rejected HERE. A banned flag reads as banned even past its expiry -- stricter than the sign-in path until an
// unban clears it, and the ban hooks delete keys anyway; this is the backstop. All token failures are one
// indistinguishable 401: whether a key is unknown, expired, disabled, or merely under-scoped is not an oracle we
// hand to whoever found a token.
//----------------------------------------------------------------------------------------------------------------------

// Models
import {
    ACCESS_TOKEN_CONFIG_PAT,
    ACCESS_TOKEN_CONFIG_PLAYBACK,
    ACCESS_TOKEN_PREFIX,
    PLAYBACK_TOKEN_PREFIX,
    type PermissionStatement,
    UnauthorizedError,
} from '@fileshed/core';

// Resource Access
import type { Auth, SessionUser } from '../resource-access/auth.ts';

//----------------------------------------------------------------------------------------------------------------------

export type Credential
    = | { kind : 'request'; headers : Headers; urlToken ?: string | null }
    | { kind : 'token'; value : string };

export type Actor
    = | { kind : 'session'; user : SessionUser }
    | { kind : 'token'; user : SessionUser; permissions : PermissionStatement };

//----------------------------------------------------------------------------------------------------------------------

// The key's prefix names its configuration -- which the plugin's verify requires up front (it must pick a hashing
// config before it can look anything up; without a configId it demands a config literally named 'default', which
// this deployment deliberately lacks). A recognized prefix routes the lookup; anything else is not our credential
// and fails closed before touching the database.
function configIdFor(token : string) : string | null
{
    if(token.startsWith(ACCESS_TOKEN_PREFIX)) { return ACCESS_TOKEN_CONFIG_PAT; }
    if(token.startsWith(PLAYBACK_TOKEN_PREFIX)) { return ACCESS_TOKEN_CONFIG_PLAYBACK; }

    return null;
}

function bearerToken(headers : Headers) : string | null
{
    const header = headers.get('authorization');
    if(header === null) { return null; }

    const [ scheme, ...rest ] = header.split(' ');
    if(scheme === undefined || scheme.toLowerCase() !== 'bearer') { return null; }

    const value = rest.join(' ').trim();
    return value.length > 0 ? value : null;
}

//----------------------------------------------------------------------------------------------------------------------

export class SessionManager
{
    readonly #auth : Auth;

    constructor(auth : Auth)
    {
        this.#auth = auth;
    }

    async getUser(headers : Headers) : Promise<SessionUser | null>
    {
        const session = await this.#auth.api.getSession({ headers });
        return session?.user ?? null;
    }

    async requireUser(headers : Headers) : Promise<SessionUser>
    {
        const user = await this.getUser(headers);
        if(!user) { throw new UnauthorizedError('Sign-in required.'); }

        return user;
    }

    // The common HTTP shape of resolveActor: headers in, demanded statement enforced. Routes with a URL-borne
    // token (the download route) build the request credential themselves.
    async requireActor(headers : Headers, required : PermissionStatement) : Promise<Actor>
    {
        return this.resolveActor({ kind: 'request', headers }, required);
    }

    async resolveActor(credential : Credential, required ?: PermissionStatement) : Promise<Actor>
    {
        if(credential.kind === 'token')
        {
            return this.#tokenActor(credential.value, required);
        }

        const user = await this.getUser(credential.headers);
        if(user) { return { kind: 'session', user }; }

        const token = bearerToken(credential.headers) ?? credential.urlToken ?? null;
        if(token === null) { throw new UnauthorizedError('Sign-in required.'); }

        return this.#tokenActor(token, required);
    }

    async #tokenActor(token : string, required ?: PermissionStatement) : Promise<Actor>
    {
        const configId = configIdFor(token);
        if(configId === null) { throw new UnauthorizedError('Invalid access token.'); }

        // The plugin throws its own APIError for anything it dislikes about the verify call; every failure shape
        // collapses into the same 401 rather than leaking as a 500 or an oracle.
        let result;
        try
        {
            result = await this.#auth.api.verifyApiKey({
                body: { key: token, configId, ...(required ? { permissions: required } : {}) },
            });
        }
        catch
        {
            throw new UnauthorizedError('Invalid access token.');
        }

        if(!result.valid || !result.key)
        {
            throw new UnauthorizedError('Invalid access token.');
        }

        const context = await this.#auth.$context;
        const user = await context.internalAdapter.findUserById(result.key.referenceId);

        if(!user || (user as SessionUser).banned === true)
        {
            throw new UnauthorizedError('Invalid access token.');
        }

        return { kind: 'token', user: user as SessionUser, permissions: result.key.permissions ?? {} };
    }
}

//----------------------------------------------------------------------------------------------------------------------
