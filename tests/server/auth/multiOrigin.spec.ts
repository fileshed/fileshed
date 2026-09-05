//----------------------------------------------------------------------------------------------------------------------
// Auth — the origins an instance answers on
//
// This file runs as production, set before the imports: better-auth reads NODE_ENV and TEST once as its own module
// loads, turning its origin check off entirely under a test environment, and an instance built that way accepts every
// origin and proves nothing. Both variables go back afterwards -- the worker process is shared with the files that
// run after this one.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const savedEnv = vi.hoisted(() =>
{
    const saved = { NODE_ENV: process.env['NODE_ENV'], TEST: process.env['TEST'] };

    process.env['NODE_ENV'] = 'production';
    process.env['TEST'] = 'false';

    return saved;
});

// Resource Access
import { resolveBaseURL, resolveTrustedOrigins } from '@server/resource-access/auth.ts';

// Support
import { ORIGIN, bootTestApp, cookieFrom, testConfig } from './support.ts';

// Utils
import type { Config } from '@server/utils/config.ts';

//----------------------------------------------------------------------------------------------------------------------

// The second URL an instance answers on -- an internal hostname beside the public one -- and a host no deployment
// configured. Both share BASE_URL's scheme, which the config loader requires.
const ALTERNATE = 'http://files.internal:3950';
const UNKNOWN = 'http://somewhere-else.example:3950';

const EMAIL = 'ada@example.com';
const PASSWORD = 'correct-horse-battery';

const GITHUB = { GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret' };

afterEach(() => { process.env['NODE_ENV'] = 'production'; });

afterAll(() =>
{
    for(const [ key, value ] of Object.entries(savedEnv))
    {
        if(value === undefined) { Reflect.deleteProperty(process.env, key); }
        else { process.env[key] = value; }
    }
});

//----------------------------------------------------------------------------------------------------------------------

describe('resolveBaseURL', () =>
{
    it('allows the canonical host alone when nothing is configured', () =>
    {
        expect(resolveBaseURL(testConfig()).allowedHosts).toEqual([ 'localhost:3000' ]);
    });

    // Hosts, not origins: the scheme lives in `protocol` and a request is matched on its Host header, which carries
    // the port and nothing else.
    it('lists each configured origin by host and port, the canonical host first', () =>
    {
        const config = testConfig({ TRUSTED_ORIGINS: [ ALTERNATE, 'http://files.example.com' ] });

        expect(resolveBaseURL(config).allowedHosts)
            .toEqual([ 'localhost:3000', 'files.internal:3950', 'files.example.com' ]);
    });

    it('does not repeat the canonical host when it is configured again', () =>
    {
        const config = testConfig({ TRUSTED_ORIGINS: [ ORIGIN, ALTERNATE ] });

        expect(resolveBaseURL(config).allowedHosts).toEqual([ 'localhost:3000', 'files.internal:3950' ]);
    });

    // The protocol is single-valued for every host, and it is also what makes session cookies Secure, so it follows
    // the canonical URL: an https deployment builds https URLs and sets Secure cookies, an http one neither.
    it('takes its protocol from BASE_URL and falls back to BASE_URL itself', () =>
    {
        expect(resolveBaseURL(testConfig())).toMatchObject({ protocol: 'http', fallback: ORIGIN });

        const secure = testConfig({ BASE_URL: 'https://files.example.com' });

        expect(resolveBaseURL(secure)).toMatchObject({
            protocol: 'https',
            fallback: 'https://files.example.com',
        });
    });

    it('lists a configured host beside the origins, written as a host rather than a URL', () =>
    {
        const config = testConfig({ ALLOWED_HOSTS: [ 'files.internal:3950' ] });

        expect(resolveBaseURL(config).allowedHosts).toEqual([ 'localhost:3000', 'files.internal:3950' ]);
    });

    // A dev box gets reached however is handy -- localhost, a LAN address, a .local name -- and answers as whatever
    // it was reached by. Stated in the config rather than inferred, so a deployment cannot fall into it by starting
    // the process without an environment variable set.
    it('answers on any host when the config says any host', () =>
    {
        const config = testConfig({ ALLOWED_HOSTS: [ '*' ] });

        expect(resolveBaseURL(config).allowedHosts).toEqual([ 'localhost:3000', '*' ]);
    });

    // The wildcard is an origin list's whole value, and better-auth matches hosts here -- carrying it across would
    // put a pattern in the host list that the config never asked for.
    it('does not turn a wide-open origin list into a wide-open host list', () =>
    {
        const config = testConfig({ TRUSTED_ORIGINS: [ '*' ] });

        expect(resolveBaseURL(config).allowedHosts).toEqual([ 'localhost:3000' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('resolveTrustedOrigins', () =>
{
    // better-auth derives the trust list from allowedHosts and the fallback on its own; the sign-in cases below are
    // what prove it, and adding the same origins here again would only duplicate the list.
    it('adds nothing of its own for a named list', () =>
    {
        expect(resolveTrustedOrigins(testConfig({ TRUSTED_ORIGINS: [ ALTERNATE ] }))).toEqual([]);
    });

    it('matches any origin when the config says any origin', () =>
    {
        expect(resolveTrustedOrigins(testConfig({ TRUSTED_ORIGINS: [ '*' ] }))).toEqual([ '*' ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------

let clients = 0;

type Post = (from : string, endpoint : string, body : unknown, extra ?: Record<string, string>) => Promise<Response>;

// Boots an instance and hands back a request bound to its own forwarded client address: production rate limiting
// buckets by IP, and cases sharing a bucket would start refusing each other at three sign-ins per ten seconds.
// `from` is the origin the browser sits on -- it supplies both the Host the request arrives at and the Origin
// header -- and `extra` is there for the cases that forge one of those.
async function bootPoster(overrides : Partial<Config>) : Promise<Post>
{
    const booted = await bootTestApp(overrides);
    const address = `10.0.0.${ ++clients }`;

    return (from, endpoint, body, extra = {}) => booted.app.request(`${ from }${ endpoint }`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'origin': from,
            'x-forwarded-for': address,
            ...extra,
        },
        body: JSON.stringify(body),
    });
}

// An instance trusting the given origins with its account already signed up through the canonical one.
async function emailClient(trusted : string[]) : Promise<(from : string) => Promise<Response>>
{
    const post = await bootPoster({ TRUSTED_ORIGINS: trusted });
    await post(ORIGIN, '/api/auth/sign-up/email', { email: EMAIL, name: 'Ada Lovelace', password: PASSWORD });

    return (from) => post(from, '/api/auth/sign-in/email', { email: EMAIL, password: PASSWORD });
}

describe('sign-in origin check', () =>
{
    it('signs in from a configured alternate origin', async () =>
    {
        const signIn = await emailClient([ ALTERNATE ]);

        const res = await signIn(ALTERNATE);

        expect(res.status).toBe(200);
        expect(cookieFrom(res)).not.toBe('');
    });

    it('refuses a sign-in from an origin the deployment never listed', async () =>
    {
        const signIn = await emailClient([ ALTERNATE ]);

        const res = await signIn(UNKNOWN);
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.message).toMatch(/origin/i);
        expect(cookieFrom(res)).toBe('');
    });

    // The control for the first case: the same origin, the same credentials, refused when the list does not carry
    // it. Without this, a sign-in that succeeds proves nothing about the configuration.
    it('refuses that same alternate origin when nothing is configured', async () =>
    {
        const signIn = await emailClient([]);

        const res = await signIn(ALTERNATE);

        expect(res.status).toBe(403);
        expect(cookieFrom(res)).toBe('');
    });

    it('still signs in from BASE_URL with alternates configured', async () =>
    {
        const signIn = await emailClient([ ALTERNATE ]);

        const res = await signIn(ORIGIN);

        expect(res.status).toBe(200);
        expect(cookieFrom(res)).not.toBe('');
    });
});

//----------------------------------------------------------------------------------------------------------------------

// The redirect_uri better-auth put in the provider's authorization URL.
async function redirectURI(res : Response) : Promise<string | null>
{
    const body = await res.json();

    return new URL(body.url).searchParams.get('redirect_uri');
}

describe('provider sign-in callback', () =>
{
    async function socialClient(trusted : string[]) : Promise<Post>
    {
        return bootPoster({ TRUSTED_ORIGINS: trusted, ...GITHUB });
    }

    const startSignIn = (post : Post, from : string, extra ?: Record<string, string>) : Promise<Response> =>
        post(from, '/api/auth/sign-in/social', { provider: 'github', callbackURL: '/' }, extra);

    // The whole point of the alternate hosts: the browser goes to the provider and comes back to the origin it
    // started from, not to the canonical URL.
    it('sends the provider back to the alternate origin the sign-in started from', async () =>
    {
        const post = await socialClient([ ALTERNATE ]);

        const res = await startSignIn(post, ALTERNATE);

        expect(res.status).toBe(200);
        expect(await redirectURI(res)).toBe(`${ ALTERNATE }/api/auth/callback/github`);
    });

    it('sends it back to the canonical URL for a sign-in started there', async () =>
    {
        const post = await socialClient([ ALTERNATE ]);

        const res = await startSignIn(post, ORIGIN);

        expect(res.status).toBe(200);
        expect(await redirectURI(res)).toBe(`${ ORIGIN }/api/auth/callback/github`);
    });

    // An anonymous provider sign-in is not origin-checked at all -- better-auth validates the Origin header only
    // once a request carries cookies -- so the allowlist is the whole defense here, and it holds: an unlisted
    // caller gets an authorization URL that comes back to us, which is what it would have got by visiting the
    // canonical site itself.
    it('gives an unlisted origin the canonical callback rather than its own', async () =>
    {
        const post = await socialClient([ ALTERNATE ]);

        const res = await startSignIn(post, UNKNOWN);

        expect(res.status).toBe(200);
        expect(await redirectURI(res)).toBe(`${ ORIGIN }/api/auth/callback/github`);
    });

    // With a session in the jar there is something to protect, and the origin check runs: a signed-in browser
    // parked on an unlisted origin cannot start a provider flow at all.
    it('refuses one carrying a session from an origin the deployment never listed', async () =>
    {
        const post = await socialClient([ ALTERNATE ]);
        const signUp = await post(
            ORIGIN,
            '/api/auth/sign-up/email',
            { email: EMAIL, name: 'Ada Lovelace', password: PASSWORD }
        );

        const res = await startSignIn(post, UNKNOWN, { cookie: cookieFrom(signUp) });
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.message).toMatch(/origin/i);
    });

    // A forged Host is the reason allowedHosts exists. The fallback answers for anything unlisted, so the worst a
    // spoofed header achieves is the canonical URL -- never a callback pointing at the attacker.
    it('ignores a forged Host header, falling back to the canonical URL', async () =>
    {
        const post = await socialClient([ ALTERNATE ]);

        const res = await startSignIn(post, ORIGIN, { host: 'evil.example' });

        expect(res.status).toBe(200);
        expect(await redirectURI(res)).toBe(`${ ORIGIN }/api/auth/callback/github`);
    });

    // Same for the proxy header, which better-auth trusts by default once baseURL is host-derived.
    it('ignores a forged X-Forwarded-Host header the same way', async () =>
    {
        const post = await socialClient([ ALTERNATE ]);

        const res = await startSignIn(post, ORIGIN, { 'x-forwarded-host': 'evil.example' });

        expect(res.status).toBe(200);
        expect(await redirectURI(res)).toBe(`${ ORIGIN }/api/auth/callback/github`);
    });
});

//----------------------------------------------------------------------------------------------------------------------
