//----------------------------------------------------------------------------------------------------------------------
// FileShed Server
//
// createApp wires the request pipeline. The gated-capability pattern lives here: the admin() plugin is enabled for its
// machinery, but its HTTP surface (/api/auth/admin/*) is refused before the auth mount ever sees it, so the only admin
// surface reachable from outside is ours (/api/admin/*). See targetsAuthAdminSurface for the matching rules.
//
// A no-arg createApp() (the default export) mounts only the public routes -- no auth instance, no admin surface. It
// exists so the health/smoke path is exercisable without a database or secret.
//----------------------------------------------------------------------------------------------------------------------

import { Hono } from 'hono';

// Routes
import health from './routes/health.ts';
import { createAdminRoutes } from './routes/admin.ts';

// Resource Access
import { type Auth, createAuth } from './resource-access/auth.ts';
import { createDatabase } from './resource-access/database/database.ts';
import { initialize } from './resource-access/boot.ts';

// Managers
import { AdminManager } from './managers/admin.ts';
import { SessionManager } from './managers/session.ts';
import { ForbiddenError } from './managers/errors.ts';

// Utils
import { type Config, loadConfig } from './utils/config.ts';
import { getLogger } from './utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('server');

//----------------------------------------------------------------------------------------------------------------------
// Admin surface gate
//----------------------------------------------------------------------------------------------------------------------

// True when a request path targets better-auth's admin HTTP surface, which we refuse externally. Matched
// adversarially, since a single bypass reopens the whole plugin: the path is percent-decoded (so `admin%2Flist-users`
// cannot slip through as one segment), collapsed on repeated slashes (`/api/auth//admin`), and lowercased (`/ADMIN/`),
// then tested against the prefix. Blocking a superset of better-auth's real routes is the safe direction for a gate.
export function targetsAuthAdminSurface(pathname : string) : boolean
{
    let path = pathname;
    try { path = decodeURIComponent(pathname); }
    catch { /* malformed encoding: fall through with the raw path, which better-auth would 404 anyway */ }

    path = path.replace(/\/{2,}/g, '/').toLowerCase();

    return path === '/api/auth/admin' || path.startsWith('/api/auth/admin/');
}

//----------------------------------------------------------------------------------------------------------------------

export function createApp(auth ?: Auth) : Hono
{
    const app = new Hono();

    //------------------------------------------------------------------------------------------------------------------
    // Gate (before the auth mount)
    //------------------------------------------------------------------------------------------------------------------

    if(auth)
    {
        app.use('*', async (ctx, next) =>
        {
            if(targetsAuthAdminSurface(new URL(ctx.req.url).pathname))
            {
                return ctx.json({ error: 'Not Found' }, 404);
            }
            return next();
        });
    }

    //------------------------------------------------------------------------------------------------------------------
    // API Routes
    //------------------------------------------------------------------------------------------------------------------

    if(auth)
    {
        app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => auth.handler(ctx.req.raw));
        app.route('/api/admin', createAdminRoutes(new SessionManager(auth), new AdminManager(auth)));
    }

    app.route('/api/health', health);

    //------------------------------------------------------------------------------------------------------------------
    // Error Handling
    //------------------------------------------------------------------------------------------------------------------

    app.notFound((ctx) => ctx.json({ error: 'Not Found' }, 404));

    app.onError((error, ctx) =>
    {
        if(error instanceof ForbiddenError)
        {
            return ctx.json({ error: error.message }, 403);
        }

        logger.error({ err: error }, 'Unhandled error');
        return ctx.json({ error: 'Internal Server Error' }, 500);
    });

    return app;
}

//----------------------------------------------------------------------------------------------------------------------
// Boot
//----------------------------------------------------------------------------------------------------------------------

// The one composition path from empty process to serving app: config, database, auth, migrations + bootstrap, then
// the wired app. Both entries (server.ts and the Vite dev entry) consume this.
export async function bootApp() : Promise<{ app : Hono; config : Config }>
{
    const config = loadConfig();
    const handle = createDatabase(config);
    const auth = createAuth(handle, config);

    await initialize(handle, auth, config);

    return { app: createApp(auth), config };
}

//----------------------------------------------------------------------------------------------------------------------

export default createApp();

//----------------------------------------------------------------------------------------------------------------------
