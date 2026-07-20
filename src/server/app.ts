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

import { MS_PER_DAY, MS_PER_MINUTE } from '@fileshed/core';

// Routes
import health from './routes/health.ts';
import { createAdminRoutes } from './routes/admin.ts';
import { createBlobRoutes } from './routes/blobs.ts';
import { createMeRoutes } from './routes/me.ts';
import { createAccessRequestRoutes } from './routes/accessRequests.ts';
import { createDeletionOfferRoutes } from './routes/deletionOffers.ts';
import { createDirectRoutes } from './routes/direct.ts';
import { createDownloadRoutes } from './routes/downloads.ts';
import { createNodeRoutes } from './routes/nodes.ts';
import { createPublicLinkRoutes } from './routes/links.ts';
import { createShareRoutes } from './routes/shares.ts';
import { createUploadRoutes } from './routes/uploads.ts';

// Resource Access
import { type Auth, createAuth } from './resource-access/auth.ts';
import { createDatabase } from './resource-access/database/database.ts';
import { initialize } from './resource-access/boot.ts';
import { seedDefaultBackend } from './resource-access/database/seeds.ts';
import { BlobRA } from './resource-access/blob/index.ts';
import { NodeRA } from './resource-access/nodes/node.ts';
import { PublicLinkRA } from './resource-access/publicLinks/index.ts';
import { ShareRA } from './resource-access/shares/index.ts';

// Managers
import { AdminManager } from './managers/admin.ts';
import { BlobManager } from './managers/blob.ts';
import { DeletionOfferManager } from './managers/deletionOffer.ts';
import { NodeManager } from './managers/node.ts';
import { PublicLinkManager } from './managers/publicLink.ts';
import { ShareManager } from './managers/share.ts';
import { SessionManager } from './managers/session.ts';
import { mapManagerError } from './managers/errors.ts';
import { startGcTimer } from './managers/gc.ts';

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

export interface AppServices
{
    blobs : BlobManager;
    nodes : NodeManager;
    shares : ShareManager;
    publicLinks : PublicLinkManager;
    deletionOffers : DeletionOfferManager;
}

export function createApp(auth ?: Auth, services ?: AppServices) : Hono
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
        const sessions = new SessionManager(auth);

        app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => auth.handler(ctx.req.raw));
        app.route('/api', createAdminRoutes(sessions, new AdminManager(auth)));

        if(services)
        {
            app.route('/api', createBlobRoutes(sessions, services.blobs));
            app.route('/api', createUploadRoutes(sessions, services.blobs));
            app.route('/api', createNodeRoutes(sessions, services.nodes));
            app.route('/api', createMeRoutes(sessions, services.nodes));
            app.route('/api', createShareRoutes(sessions, services.shares));
            app.route('/api', createAccessRequestRoutes(sessions, services.shares));
            app.route('/api', createDownloadRoutes(sessions, services.publicLinks));
            app.route('/api', createPublicLinkRoutes(sessions, services.publicLinks));
            app.route('/api', createDeletionOfferRoutes(sessions, services.deletionOffers));
            app.route('/d', createDirectRoutes(services.publicLinks));
        }
    }

    app.route('/api', health);

    //------------------------------------------------------------------------------------------------------------------
    // Error Handling
    //------------------------------------------------------------------------------------------------------------------

    app.notFound((ctx) => ctx.json({ error: 'Not Found' }, 404));

    app.onError((error, ctx) =>
    {
        const mapped = mapManagerError(error);
        if(mapped)
        {
            return ctx.json(mapped.body, mapped.status);
        }

        logger.error({ err: error }, 'Unhandled error');
        return ctx.json({ error: 'Internal Server Error' }, 500);
    });

    return app;
}

//----------------------------------------------------------------------------------------------------------------------
// Boot
//----------------------------------------------------------------------------------------------------------------------

// The one composition path from empty process to serving app: config, database, auth, migrations + bootstrap, blob
// storage, managers, timers, then the wired app. Both entries (server.ts and the Vite dev entry) consume this.
// shutdown() stops the background timers -- anything booting more than once (specs, a future graceful-shutdown path)
// must call it, or sweeps keep firing against a torn-down database.
export async function bootApp() : Promise<{ app : Hono; config : Config; shutdown : () => void }>
{
    const config = loadConfig();
    const handle = createDatabase(config);
    const auth = createAuth(handle, config);

    await initialize(handle, auth, config);
    await seedDefaultBackend(handle, config);

    const blob = new BlobRA(handle);
    const nodeRA = new NodeRA(handle);
    const shareRA = new ShareRA(handle);
    const blobs = new BlobManager({ handle, blob, uploadMaxBytes: config.UPLOAD_MAX_BYTES });
    const nodes = new NodeManager(handle, nodeRA, blob, config.GC_GRACE_DAYS * MS_PER_DAY);
    const shares = new ShareManager(handle, nodeRA, shareRA);
    const deletionOffers = new DeletionOfferManager(handle, nodes);
    const publicLinks = new PublicLinkManager(
        nodeRA,
        blob,
        new PublicLinkRA(handle),
        (userID, nodeID) => shareRA.effectiveRole(userID, nodeID)
    );

    const stopGc = startGcTimer(
        { handle, blob, graceMs: config.GC_GRACE_DAYS * MS_PER_DAY },
        config.GC_INTERVAL_MINUTES * MS_PER_MINUTE
    );
    const stopSweeps = blobs.startSweeps();

    const shutdown = () : void =>
    {
        stopGc();
        stopSweeps();
    };

    return { app: createApp(auth, { blobs, nodes, shares, publicLinks, deletionOffers }), config, shutdown };
}

//----------------------------------------------------------------------------------------------------------------------

export default createApp();

//----------------------------------------------------------------------------------------------------------------------
