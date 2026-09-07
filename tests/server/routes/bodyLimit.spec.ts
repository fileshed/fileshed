//----------------------------------------------------------------------------------------------------------------------
// API Body Limit — what it weighs, and what it must not touch
//
// The cap refuses an oversized JSON body before anything reads it. What it must NOT do is touch a request whose body
// nothing reads, and that is not an optimization: the limiter weighs a body by draining it and then rebuilds the
// request around what it drained. The rebuild is what a body-less request cannot survive on every server this app
// runs on -- under the Vite dev server an incoming DELETE carries an empty stream rather than a null body, so the
// limiter reaches the rebuild and `new Request(...)` refuses the wrapper it is handed. Every DELETE in the API
// answered 500 there.
//
// That failure cannot be reproduced in a test: a Request built here is a real one, which the rebuild accepts, so a
// spec driving the app would pass against the broken version too. So the rule is what is asserted -- which requests
// are handed to the limiter at all -- alongside the cap still refusing what it is meant to.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';

// Models
import { API_BODY_MAX_BYTES } from '@fileshed/core';

// Under test
import { bodyLimitApplies } from '@server/app.ts';

// Support
import { type BootedApp, ORIGIN, bootTestApp } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

let booted : BootedApp | undefined;

afterEach(async () =>
{
    await booted?.handle.db.destroy();
    booted = undefined;
});

//----------------------------------------------------------------------------------------------------------------------

describe('bodyLimitApplies', () =>
{
    it('weighs the methods whose bodies this API reads', () =>
    {
        expect(bodyLimitApplies('POST', '/api/nodes')).toBe(true);
        expect(bodyLimitApplies('PATCH', '/api/me/preferences')).toBe(true);
        expect(bodyLimitApplies('PUT', '/api/admin/settings')).toBe(true);
    });

    // No GET, HEAD, DELETE or OPTIONS route here reads a body, so an unread one is never accumulated by anything this
    // cap could protect -- and handing the limiter a request it has to rebuild is what broke every DELETE in dev.
    it('leaves alone the methods whose bodies it never reads', () =>
    {
        expect(bodyLimitApplies('DELETE', '/api/links/abc')).toBe(false);
        expect(bodyLimitApplies('GET', '/api/me')).toBe(false);
        expect(bodyLimitApplies('HEAD', '/api/health')).toBe(false);
        expect(bodyLimitApplies('OPTIONS', '/api/nodes')).toBe(false);
    });

    it('reads the method however it is cased', () =>
    {
        expect(bodyLimitApplies('delete', '/api/links/abc')).toBe(false);
    });

    // The byte routes carry the product rather than a description of it, and have caps of their own.
    it('leaves the byte routes to their own ceilings', () =>
    {
        expect(bodyLimitApplies('PUT', '/api/uploads/ticket-1')).toBe(false);
        expect(bodyLimitApplies('POST', '/api/me/avatar')).toBe(false);
        expect(bodyLimitApplies('POST', '/api/admin/branding/logo')).toBe(false);
    });
});

//----------------------------------------------------------------------------------------------------------------------

describe('the cap in the composed app', () =>
{
    it('refuses a body past the ceiling before anything reads it', async () =>
    {
        booted = await bootTestApp();

        const res = await booted.app.request(`${ ORIGIN }/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'origin': ORIGIN },
            body: 'n'.repeat(API_BODY_MAX_BYTES + 1),
        });

        expect(res.status).toBe(413);
    });

    it('answers a body-less DELETE from its route rather than the limiter', async () =>
    {
        booted = await bootTestApp();

        const res = await booted.app.request(`${ ORIGIN }/api/me/access-tokens/nonexistent`, { method: 'DELETE' });

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
