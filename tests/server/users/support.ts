//----------------------------------------------------------------------------------------------------------------------
// User Lookup Spec Support
//
// Boots the exact-email lookup surface the way app.ts wires it: real auth, a real in-memory database + migrations, and
// the user route over a real UserManager/UserRA. No blob backend or node routes -- the lookup touches only the user
// table. onError uses the production mapManagerError, so specs drive the flow with app.request and real session
// cookies. Zero mocks.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Resource Access
import { type Auth, createAuth } from '@server/resource-access/auth.ts';
import { type DatabaseHandle, createDatabase } from '@server/resource-access/database/database.ts';
import { initialize } from '@server/resource-access/boot.ts';
import { UserRA } from '@server/resource-access/users/index.ts';

// Managers
import { SessionManager } from '@server/managers/session.ts';
import { UserManager } from '@server/managers/user.ts';
import { mapManagerError } from '@server/managers/errors.ts';

// Routes
import { createUserRoutes } from '@server/routes/users.ts';

// Auth support (real sign-up / sign-in over the same app)
import { ORIGIN, cookieFrom, signIn, signUp, testConfig } from '../auth/support.ts';

export { ORIGIN } from '../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface BootedUserApp
{
    app : Hono;
    handle : DatabaseHandle;
    auth : Auth;
    cleanup : () => Promise<void>;
}

export async function bootUserApp() : Promise<BootedUserApp>
{
    const config = testConfig();
    const handle = createDatabase(config);
    const auth = createAuth(handle, config);
    await initialize(handle, auth, config);

    const sessions = new SessionManager(auth);
    const users = new UserManager(new UserRA(handle));

    const app = new Hono();
    app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => auth.handler(ctx.req.raw));
    app.route('/api', createUserRoutes(sessions, users));

    app.notFound((ctx) => ctx.json({ error: 'Not Found' }, 404));
    app.onError((error, ctx) =>
    {
        const mapped = mapManagerError(error);
        if(mapped) { return ctx.json(mapped.body, mapped.status); }
        return ctx.json({ error: 'Internal Server Error' }, 500);
    });

    return {
        app,
        handle,
        auth,
        cleanup: async () => { await handle.db.destroy(); },
    };
}

//----------------------------------------------------------------------------------------------------------------------
// Users
//----------------------------------------------------------------------------------------------------------------------

export interface TestUser
{
    id : string;
    cookie : string;
    email : string;
    name : string;
}

// Sign up and sign in, returning the user's id (as the FKs see it), their display name, and their session cookie.
export async function makeUser(booted : BootedUserApp, email : string, name : string) : Promise<TestUser>
{
    const password = 'correct-horse-battery';
    await signUp(booted.app, email, password, name);
    const cookie = cookieFrom(await signIn(booted.app, email, password));

    const row = await booted.handle.db
        .selectFrom('user')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();

    return { id: row.id, cookie, email, name };
}

//----------------------------------------------------------------------------------------------------------------------
// HTTP
//----------------------------------------------------------------------------------------------------------------------

export function request(app : Hono, method : string, path : string, cookie ?: string) : Promise<Response>
{
    const headers : Record<string, string> = {};
    if(cookie) { headers['cookie'] = cookie; }

    return app.request(`${ ORIGIN }${ path }`, { method, headers });
}

//----------------------------------------------------------------------------------------------------------------------
