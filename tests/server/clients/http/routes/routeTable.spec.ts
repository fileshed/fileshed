//----------------------------------------------------------------------------------------------------------------------
// App Route Table
//
// The composed app's full wire surface, pinned. Route files own their full paths and every feature router mounts at
// /api, so nothing structural stops two files claiming the same method+path -- this spec is that backstop, and its
// expected table (tests/support/routeTable.ts) is the reviewable URL map: adding, moving, or removing a route must show
// up in that file's diff.
//
// Only terminal handlers count. A describeRoute doc spec is a per-route middleware, and Hono records every handler in a
// route's chain as its own entry in app.routes, so a decorated route carries a second entry at the same method+path.
// Middleware takes (ctx, next) -- arity 2 -- while a terminal handler takes (ctx); filtering on arity keeps exactly the
// terminal registrations, so the invariant this table asserts is that no two TERMINAL handlers share a method+path.
//----------------------------------------------------------------------------------------------------------------------

import { afterAll, describe, expect, it } from 'vitest';

// Resource Access
import { createAuth } from '@server/resource-access/auth/instance.ts';
import { createDatabase } from '@server/resource-access/database/database.ts';

// Support
import { SERVER_ROUTES } from '../../../../support/routeTable.ts';
import { TEST_AUTH_SECRET, composeTestApp, testConfig } from '../../../auth/support.ts';

//----------------------------------------------------------------------------------------------------------------------

// Route registration is pure composition -- no request is ever served, so the database never needs migrating and the
// storage root is never touched.
const config = testConfig();
const handle = createDatabase(config);
const auth = createAuth(handle, config, TEST_AUTH_SECRET);

const app = composeTestApp(auth, handle, config);

afterAll(async () =>
{
    await handle.db.destroy();
});

//----------------------------------------------------------------------------------------------------------------------

describe('createApp route table', () =>
{
    // Exact equality catches every failure mode at once: a missing route, an unexpected one, and two routers
    // registering the same method+path (the duplicate appears twice on the actual side). Doc-spec middleware (arity 2)
    // is filtered out so only terminal handlers are compared.
    it('registers exactly the declared wire surface', () =>
    {
        const actual = app.routes
            .filter((route) => route.method !== 'ALL' && route.handler.length < 2)
            .map((route) => `${ route.method } ${ route.path }`);

        expect([ ...actual ].sort()).toEqual([ ...SERVER_ROUTES ].sort());
    });
});

//----------------------------------------------------------------------------------------------------------------------
