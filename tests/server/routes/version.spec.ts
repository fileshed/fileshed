//----------------------------------------------------------------------------------------------------------------------
// Version Route — GET /api/version
//
// A signed-in user can read what the instance runs; an anonymous one cannot. The route carries whatever build it was
// composed with straight out to the wire, including the nulls a build that recorded no git facts reports -- the
// client renders those three fields, so a missing one is a broken label rather than a missing detail.
//----------------------------------------------------------------------------------------------------------------------

import { createRequire } from 'node:module';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

// Managers
import { SessionManager } from '@server/managers/session.ts';

// Routes
import { createVersionRoutes } from '@server/routes/version.ts';

// Utils
import type { BuildInfo } from '@server/utils/version.ts';

// Support
import { ORIGIN, bootTestApp, cookieFrom, signUp } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

const rootManifest = createRequire(import.meta.url)('../../../package.json') as { version : string };

// Deliberately not the real build: the route's job is to carry what it was composed with, and asserting against the
// live constant would hold even if the handler hardcoded its answer.
const INJECTED_BUILD : BuildInfo = { version: '7.7.7-version-spec', commit: 'a0931ee', branch: 'topic-branch' };

//----------------------------------------------------------------------------------------------------------------------

// The route over a real session manager, beside the app that issued the cookie -- both read the one auth instance.
async function mountWith(build : BuildInfo) : Promise<{ app : Hono; cookie : string }>
{
    const booted = await bootTestApp();
    const cookie = cookieFrom(await signUp(booted.app, 'a@example.com', 'correct-horse-battery'));

    const app = new Hono();
    app.route('/api', createVersionRoutes(new SessionManager(booted.auth), build));

    return { app, cookie };
}

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/version', () =>
{
    it('reports the build it was composed with to a signed-in user', async () =>
    {
        const { app, cookie } = await mountWith(INJECTED_BUILD);

        const res = await app.request(`${ ORIGIN }/api/version`, { headers: { cookie } });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(INJECTED_BUILD);
    });

    it('reports a build with no git facts as nulls rather than omitting the fields', async () =>
    {
        const build : BuildInfo = { version: '7.7.7-version-spec', commit: null, branch: null };
        const { app, cookie } = await mountWith(build);

        const res = await app.request(`${ ORIGIN }/api/version`, { headers: { cookie } });

        expect(await res.json()).toEqual({ version: '7.7.7-version-spec', commit: null, branch: null });
    });

    // Against the composed app rather than the bare mount above: turning the refusal into a 401 is the app's own
    // error handling, and a bare router would only prove that the route threw something.
    it('refuses a request with no session', async () =>
    {
        const { app } = await bootTestApp();

        const res = await app.request(`${ ORIGIN }/api/version`);

        expect(res.status).toBe(401);
    });

    // The composed app is what a deployment serves, so the version it answers has to be the one a release tags.
    it('answers the workspace root\'s version from the composed app', async () =>
    {
        const booted = await bootTestApp();
        const cookie = cookieFrom(await signUp(booted.app, 'a@example.com', 'correct-horse-battery'));

        const res = await booted.app.request(`${ ORIGIN }/api/version`, { headers: { cookie } });
        const body = await res.json() as { version : string; commit : string | null };

        expect(res.status).toBe(200);
        expect(body.version).toBe(rootManifest.version);

        // A checkout reports a short hash; a build without one reports null. Both are correct, a long hash is not.
        expect(body.commit === null || /^[0-9a-f]{7}$/.test(body.commit)).toBe(true);
    });
});

//----------------------------------------------------------------------------------------------------------------------
