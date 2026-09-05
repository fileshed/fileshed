//----------------------------------------------------------------------------------------------------------------------
// E2E — The request budget, over a real socket
//
// The limiter and its engine are proven in isolation elsewhere. What only a real server can answer is whether the
// middleware is mounted ahead of the routes it defends, and whether a client is identified by something it cannot
// choose. Both are invisible to an in-process spec: a context built by app.request carries no socket, and the limiter
// deliberately lets those through rather than counting every one of them into a single bucket that anybody could then
// exhaust for the whole instance.
//
// So this is the only place the headline finding is actually closed: better-auth resolves a client from headers alone,
// which is why rotating one defeated its throttling entirely. Here the forwarded header is rotated on every request
// and the budget still runs out, because the socket is what counts.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Support
import { ApiClient, type ServerHandle, spawnServer } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

// Small enough that the spec spends seconds rather than minutes, and far enough under the attempt count that an
// off-by-one in the budget cannot make this pass by accident.
const CREDENTIAL_BUDGET = 5;
const ATTEMPTS = 15;

let server : ServerHandle;

//----------------------------------------------------------------------------------------------------------------------

// A wrong password from a fresh forwarded address every time -- the exact shape that got 60 guesses out of 60 past
// better-auth's own limiter.
async function guessFrom(attempt : number) : Promise<number>
{
    const res = await fetch(`${ server.baseURL }/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'origin': server.baseURL,
            'x-forwarded-for': `203.0.113.${ attempt }`,
        },
        body: JSON.stringify({ email: 'nobody@example.test', password: 'wrong-password' }),
    });
    await res.arrayBuffer();

    return res.status;
}

//----------------------------------------------------------------------------------------------------------------------

beforeAll(async () =>
{
    server = await spawnServer({
        env: { RATE_LIMIT_CREDENTIALS_MAX: String(CREDENTIAL_BUDGET), RATE_LIMIT_WINDOW_SECONDS: '60' },
    });
});

afterAll(async () =>
{
    await server?.stop();
});

//----------------------------------------------------------------------------------------------------------------------

describe('the credential budget over a real socket', () =>
{
    it('runs out however the forwarded header is rotated', async () =>
    {
        const statuses : number[] = [];
        for(let attempt = 0; attempt < ATTEMPTS; attempt += 1)
        {
            // eslint-disable-next-line no-await-in-loop -- a budget is only spent by requests that went in order
            statuses.push(await guessFrom(attempt));
        }

        expect(statuses.filter((status) => status === 429)).toHaveLength(ATTEMPTS - CREDENTIAL_BUDGET);
        expect(statuses.slice(0, CREDENTIAL_BUDGET).every((status) => status === 401)).toBe(true);
    });

    it('still serves the surfaces a signed-in page needs after the credential budget is spent', async () =>
    {
        // The general tier is its own budget, and get-session rides it deliberately: every page load asks for one,
        // so putting it beside sign-in would take the whole app down with a burst of bad passwords.
        const client = new ApiClient(server.baseURL);

        expect((await client.get('/api/instance')).status).toBe(200);
        expect((await client.get('/api/auth/get-session')).status).toBe(200);
    });
});

//----------------------------------------------------------------------------------------------------------------------
