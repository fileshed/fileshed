//----------------------------------------------------------------------------------------------------------------------
// User Lookup Spec Support
//----------------------------------------------------------------------------------------------------------------------

import type { Hono } from 'hono';

// Support
import { ORIGIN, cookieFrom, signIn, signUp } from '../auth/support.ts';
import type { BootedStoreApp } from '../support/storeApp.ts';

export { ORIGIN } from '../auth/support.ts';
export { type BootedStoreApp, bootStoreApp } from '../support/storeApp.ts';

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
export async function makeUser(booted : BootedStoreApp, email : string, name : string) : Promise<TestUser>
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

export async function request(app : Hono, method : string, path : string, cookie ?: string) : Promise<Response>
{
    const headers : Record<string, string> = {};
    if(cookie) { headers['cookie'] = cookie; }

    return app.request(`${ ORIGIN }${ path }`, { method, headers });
}

//----------------------------------------------------------------------------------------------------------------------
