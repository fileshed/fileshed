//----------------------------------------------------------------------------------------------------------------------
// Rate Limit Middleware — the budget over real auth endpoints
//
// Driven against the real better-auth sign-in handler, mounted the way the app mounts it, because the contract under
// test is about a whole request: what the limiter decides has to survive the headers an attacker actually sends.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

// Middleware
import { type RateLimitOptions, createRateLimit } from '@server/middleware/rateLimit.ts';

// Test support
import { ORIGIN, bootTestApp, signUp } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const EMAIL = 'guessable@example.com';
const PASSWORD = 'correct-horse-battery-staple';

// The attacker's own connection. Every request in a forgery case arrives on it, whatever the headers claim.
const ATTACKER = '203.0.113.9';

const closers : (() => void)[] = [];

afterEach(() =>
{
    for(const close of closers.splice(0)) { close(); }
});

//----------------------------------------------------------------------------------------------------------------------

type Attempt = (headers ?: Record<string, string>) => Promise<Response>;

interface Harness
{
    signInWrongly : Attempt;
    readSession : Attempt;
}

// A Hono app carrying the limiter and the auth mount, and nothing else -- the composition app.ts wires, reduced to
// the two parts this is about.
async function harness(options : Partial<RateLimitOptions> & { peer : string }) : Promise<Harness>
{
    const booted = await bootTestApp();
    closers.push(() => { void booted.handle.db.destroy(); });

    const app = new Hono();
    app.use('*', createRateLimit({
        enabled: true,
        windowSeconds: 60,
        max: { api: 600, credentials: 5, anonymous: 120 },
        trustedProxies: [],
        ...options,
        socketAddress: () => options.peer,
    }));
    app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => booted.auth.handler(ctx.req.raw));

    await signUp(booted.app, EMAIL, PASSWORD);

    return {
        signInWrongly: (headers = {}) => app.request(`${ ORIGIN }/api/auth/sign-in/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'origin': ORIGIN, ...headers },
            body: JSON.stringify({ email: EMAIL, password: 'not-the-password' }),
        }),
        readSession: (headers = {}) => app.request(`${ ORIGIN }/api/auth/get-session`, {
            headers: { origin: ORIGIN, ...headers },
        }),
    };
}

// Sequential on purpose: a budget is spent in order, and parallel requests would race the window rather than test it.
async function statuses(count : number, run : (index : number) => Promise<Response>) : Promise<number[]>
{
    const collected : number[] = [];

    for(let index = 0; index < count; index += 1)
    {
        // eslint-disable-next-line no-await-in-loop -- one request at a time is the shape under test
        collected.push((await run(index)).status);
    }

    return collected;
}

//----------------------------------------------------------------------------------------------------------------------

describe('createRateLimit', () =>
{
    it('refuses sign-in attempts past the credential budget', async () =>
    {
        const { signInWrongly } = await harness({ peer: ATTACKER });

        const answers = await statuses(8, () => signInWrongly());

        expect(answers).toEqual([ 401, 401, 401, 401, 401, 429, 429, 429 ]);
    });

    it('keeps counting guesses from one socket however the forwarded header is rotated', async () =>
    {
        const { signInWrongly } = await harness({ peer: ATTACKER });

        // A fresh, unauthenticated claim about who is asking, on every single request.
        const answers = await statuses(60, (index) =>
            signInWrongly({ 'x-forwarded-for': `198.51.100.${ index % 256 }` }));

        expect(answers.filter((status) => status === 401)).toHaveLength(5);
        expect(answers.filter((status) => status === 429)).toHaveLength(55);
    });

    it('answers a refusal with the seconds until the budget resets', async () =>
    {
        const { signInWrongly } = await harness({ peer: ATTACKER });

        await statuses(5, () => signInWrongly());
        const refused = await signInWrongly();

        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(Number(refused.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    });

    it('gives each client behind a trusted proxy its own budget', async () =>
    {
        const proxy = '10.0.0.7';
        const { signInWrongly } = await harness({ peer: proxy, trustedProxies: [ '10.0.0.0/24' ] });

        // The header nginx's stock `proxy_add_x_forwarded_for` produces: the client, then the proxy that appended it.
        const asClient = (client : string) : Record<string, string> =>
            ({ 'x-forwarded-for': `${ client }, ${ proxy }` });

        const first = await statuses(6, () => signInWrongly(asClient('198.51.100.4')));
        const second = await signInWrongly(asClient('198.51.100.5'));

        expect(first.at(-1)).toBe(429);
        expect(second.status).toBe(401);
    });

    it('ignores a forwarded header appended by a peer that is not a named proxy', async () =>
    {
        // The proxy list is real, but this connection did not come from it.
        const { signInWrongly } = await harness({ peer: ATTACKER, trustedProxies: [ '10.0.0.0/24' ] });

        const answers = await statuses(8, (index) =>
            signInWrongly({ 'x-forwarded-for': `198.51.100.${ index }, 10.0.0.7` }));

        expect(answers.filter((status) => status === 429)).toHaveLength(3);
    });

    it('leaves ordinary session reads on the general budget rather than the credential one', async () =>
    {
        const { readSession } = await harness({ peer: ATTACKER });

        const answers = await statuses(20, () => readSession());

        expect(answers).not.toContain(429);
    });

    it('counts nothing when it is switched off', async () =>
    {
        const { signInWrongly } = await harness({ enabled: false, peer: ATTACKER });

        const answers = await statuses(8, () => signInWrongly());

        expect(answers).toEqual([ 401, 401, 401, 401, 401, 401, 401, 401 ]);
    });
});

//----------------------------------------------------------------------------------------------------------------------
