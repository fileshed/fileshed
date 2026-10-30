//----------------------------------------------------------------------------------------------------------------------
// Session Manager
//
// Every authenticated route resolves who is asking through this manager, on one of two credential planes. requireUser
// is the session-only plane -- routes with no business accepting anything but a signed-in browser (admin, account
// security, token management itself) stay on it, and tokens simply do not exist for them. resolveActor is the wider
// plane for routes that opted into access tokens: it tries the session first (a browser on the media page sends both
// its cookie and a tokened src URL -- the session wins), then a bearer header, then a route-supplied URL token.
//
// An account whose owner has asked for it to be deleted is refused here too, everywhere but the two surfaces that
// exist for it: reading its own profile, and calling the deletion off. Sign-in stays open on purpose -- the person
// who owns the account has to be able to get in and undo this -- so the refusal is what turns an open session into
// an interstitial rather than a working drive. Those two routes ask for the exemption by name.
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
    ForbiddenError,
    PLAYBACK_TOKEN_PREFIX,
    type PermissionStatement,
    UnauthorizedError,
} from '@fileshed/core';

// Resource Access
import type { AuthRA } from '../resource-access/auth/index.ts';
import type { SessionUser } from '../resource-access/auth/instance.ts';

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
function configIDFor(token : string) : string | null
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

// What a route says about a caller whose account is on its way out. Only the two surfaces that exist for such an
// account -- reading its own profile, and calling the deletion off -- set this.
export interface ActorOptions
{
    allowClosing ?: boolean;
}

function assertNotClosing(user : SessionUser, options : ActorOptions) : void
{
    if(options.allowClosing === true) { return; }

    if(user.deletionRequestedAt)
    {
        throw new ForbiddenError('This account is scheduled for deletion. Cancel the deletion to use it again.');
    }
}

//----------------------------------------------------------------------------------------------------------------------

export class SessionManager
{
    readonly #auth : AuthRA;

    constructor(auth : AuthRA)
    {
        this.#auth = auth;
    }

    async requireUser(headers : Headers, options : ActorOptions = {}) : Promise<SessionUser>
    {
        const user = await this.#auth.sessionUser(headers);
        if(!user) { throw new UnauthorizedError('Sign-in required.'); }

        assertNotClosing(user, options);

        return user;
    }

    // The common HTTP shape of resolveActor: headers in, demanded statement enforced. Routes with a URL-borne
    // token (the download route) build the request credential themselves.
    async requireActor(headers : Headers, required : PermissionStatement, options : ActorOptions = {}) : Promise<Actor>
    {
        return this.resolveActor({ kind: 'request', headers }, required, options);
    }

    async resolveActor(
        credential : Credential,
        required ?: PermissionStatement,
        options : ActorOptions = {}
    ) : Promise<Actor>
    {
        const actor = await this.#identify(credential, required);

        assertNotClosing(actor.user, options);

        return actor;
    }

    async #identify(credential : Credential, required ?: PermissionStatement) : Promise<Actor>
    {
        if(credential.kind === 'token')
        {
            return this.#tokenActor(credential.value, required);
        }

        const user = await this.#auth.sessionUser(credential.headers);
        if(user) { return { kind: 'session', user }; }

        const token = bearerToken(credential.headers) ?? credential.urlToken ?? null;
        if(token === null) { throw new UnauthorizedError('Sign-in required.'); }

        return this.#tokenActor(token, required);
    }

    async #tokenActor(token : string, required ?: PermissionStatement) : Promise<Actor>
    {
        const configID = configIDFor(token);
        if(configID === null) { throw new UnauthorizedError('Invalid access token.'); }

        // A 5xx from the plugin, or any other throw, is storage failing underneath it and surfaces as the 500 a
        // caller holding a good token is owed -- not a claim that the token is bad.
        const validKey = await this.#auth.validateKey(token, configID, required);
        if(validKey === null) { throw new UnauthorizedError('Invalid access token.'); }

        const user = await this.#auth.getUser(validKey.userID);
        if(user === null || user.banned === true) { throw new UnauthorizedError('Invalid access token.'); }

        return { kind: 'token', user, permissions: validKey.permissions };
    }
}

//----------------------------------------------------------------------------------------------------------------------
