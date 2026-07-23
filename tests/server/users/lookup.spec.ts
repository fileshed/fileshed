//----------------------------------------------------------------------------------------------------------------------
// User Lookup — GET /api/users/lookup?email=<exact>
//
// Drives the exact-email lookup over the real stack. Expectations: an authenticated caller resolves an existing email
// to that user's summary; the match is the whole email, case-insensitively; an unknown email is a 404 that names no
// account detail; a blank email is a 400; and no session is a 401. Exact match only -- the endpoint is not an
// enumeration oracle. Not the implementation.
//----------------------------------------------------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Support
import { type BootedUserApp, type TestUser, bootUserApp, makeUser, request } from './support.ts';

//----------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

let booted : BootedUserApp;
let caller : TestUser;
let target : TestUser;

beforeEach(async () =>
{
    booted = await bootUserApp();
    caller = await makeUser(booted, 'caller@example.com', 'Ada Caller');
    target = await makeUser(booted, 'grace@example.com', 'Grace Hopper');
});

afterEach(async () =>
{
    await booted.cleanup();
});

//----------------------------------------------------------------------------------------------------------------------

describe('GET /api/users/lookup', () =>
{
    it('resolves an exact email to that user\'s summary', async () =>
    {
        const res = await request(booted.app, 'GET', '/api/users/lookup?email=grace@example.com', caller.cookie);
        const body = await res.json() as Json;

        expect(res.status).toBe(200);
        expect(body).toEqual({
            id: target.id,
            name: 'Grace Hopper',
            email: 'grace@example.com',
            image: null,
        });
    });

    it('matches the whole email case-insensitively', async () =>
    {
        const res = await request(booted.app, 'GET', '/api/users/lookup?email=Grace@Example.COM', caller.cookie);
        const body = await res.json() as Json;

        expect(res.status).toBe(200);
        expect(body.id).toBe(target.id);
    });

    it('404s an unknown email without leaking any account detail', async () =>
    {
        const res = await request(booted.app, 'GET', '/api/users/lookup?email=nobody@example.com', caller.cookie);
        const raw = await res.text();

        expect(res.status).toBe(404);
        expect(raw).not.toContain(target.id);
        expect(raw).not.toContain('grace@example.com');
    });

    it('refuses a substring of a real email (exact match only, no enumeration)', async () =>
    {
        const res = await request(booted.app, 'GET', '/api/users/lookup?email=grace', caller.cookie);

        expect(res.status).toBe(404);
    });

    it('400s a blank email query', async () =>
    {
        const res = await request(booted.app, 'GET', '/api/users/lookup?email=', caller.cookie);

        expect(res.status).toBe(400);
    });

    it('401s a caller with no session', async () =>
    {
        const res = await request(booted.app, 'GET', '/api/users/lookup?email=grace@example.com');

        expect(res.status).toBe(401);
    });
});

//----------------------------------------------------------------------------------------------------------------------
