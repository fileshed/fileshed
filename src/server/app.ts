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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

import { MEDIA_TAG_SWEEP_BATCH, MS_PER_DAY, MS_PER_MINUTE } from '@fileshed/core';

// Routes
import health from './routes/health.ts';
import { createAccessTokenRoutes } from './routes/accessTokens.ts';
import { createAdminRoutes, createAdminStatusRoutes } from './routes/admin.ts';
import { createAvatarRoutes } from './routes/avatars.ts';
import { createBlobRoutes } from './routes/blobs.ts';
import { createMeRoutes } from './routes/me.ts';
import { createAccessRequestRoutes } from './routes/accessRequests.ts';
import { createDeletionOfferRoutes } from './routes/deletionOffers.ts';
import { createDirectRoutes } from './routes/direct.ts';
import { createDownloadRoutes } from './routes/downloads.ts';
import { createNodeRoutes } from './routes/nodes.ts';
import { mountOpenApiDocs } from './routes/openapi.ts';
import { createPublicLinkRoutes } from './routes/links.ts';
import { createSearchRoutes } from './routes/search.ts';
import { createSetupRoutes } from './routes/setup.ts';
import { createShareRoutes } from './routes/shares.ts';
import { createUploadRoutes } from './routes/uploads.ts';
import { createUserRoutes } from './routes/users.ts';

// Resource Access
import { type Auth, createAuth } from './resource-access/auth.ts';
import { createDatabase } from './resource-access/database/database.ts';
import { initialize } from './resource-access/boot.ts';
import { seedDefaultBackend } from './resource-access/database/seeds.ts';
import { BlobRA } from './resource-access/blob/index.ts';
import { NodeRA } from './resource-access/nodes/node.ts';
import { MediaTagsRA } from './resource-access/mediaTags/index.ts';
import { PublicLinkRA } from './resource-access/publicLinks/index.ts';
import { ShareRA } from './resource-access/shares/index.ts';
import { UserRA } from './resource-access/users/index.ts';

// Managers
import { AccessTokenManager } from './managers/accessToken.ts';
import { AdminManager } from './managers/admin.ts';
import { AvatarManager } from './managers/avatar.ts';
import { BlobManager } from './managers/blob.ts';
import { DeletionOfferManager } from './managers/deletionOffer.ts';
import { MediaTagManager, startMediaTagTimer } from './managers/mediaTags.ts';
import { NodeManager } from './managers/node.ts';
import { PublicLinkManager } from './managers/publicLink.ts';
import { ShareManager } from './managers/share.ts';
import { SessionManager } from './managers/session.ts';
import { SetupManager } from './managers/setup.ts';
import { UserManager } from './managers/user.ts';
import { StatusManager } from './managers/status.ts';
import { LastRunTracker } from './managers/lastRun.ts';
import { mapManagerError } from './managers/errors.ts';
import { startGcTimer } from './managers/gc.ts';
import { startTrashPurgeTimer } from './managers/trashPurge.ts';

// Utils
import { type Config, loadConfig } from './utils/config.ts';
import { getLogger } from './utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('server');

//----------------------------------------------------------------------------------------------------------------------
// Gated auth surfaces
//----------------------------------------------------------------------------------------------------------------------

// Plugin HTTP surfaces we refuse externally: the admin plugin's routes (our /api/admin is the only admin surface)
// and the api-key plugin's stock endpoints (create there would mint unscoped keys outside our vocabulary; the only
// key-management surface is /api/me/access-tokens). Matched adversarially, since a single bypass reopens the whole
// plugin: the path is percent-decoded (so `admin%2Flist-users` cannot slip through as one segment), collapsed on
// repeated slashes (`/api/auth//admin`), and lowercased (`/ADMIN/`), then tested against the prefixes. Blocking a
// superset of the plugins' real routes is the safe direction for a gate. Server-side auth.api.* calls never
// traverse HTTP, so internal minting is unaffected.
const gatedAuthPrefixes = [ '/api/auth/admin', '/api/auth/api-key' ];

export function targetsGatedAuthSurface(pathname : string) : boolean
{
    let path = pathname;
    try { path = decodeURIComponent(pathname); }
    catch { /* malformed encoding: fall through with the raw path, which better-auth would 404 anyway */ }

    path = path.replace(/\/{2,}/g, '/').toLowerCase();

    return gatedAuthPrefixes.some((prefix) => path === prefix || path.startsWith(`${ prefix }/`));
}

//----------------------------------------------------------------------------------------------------------------------

export interface AppServices
{
    blobs : BlobManager;
    mediaTags : MediaTagManager;
    avatars : AvatarManager;
    nodes : NodeManager;
    shares : ShareManager;
    publicLinks : PublicLinkManager;
    deletionOffers : DeletionOfferManager;
    adminStatus : StatusManager;
    users : UserManager;
    setup : SetupManager;
}

export interface AppOptions
{
    // The built client's directory (resolved from the working directory). Present only in production, where this
    // process serves the SPA alongside the API; development leaves the client to Vite.
    clientDist ?: string;
}

export function createApp(auth ?: Auth, services ?: AppServices, options : AppOptions = {}) : Hono
{
    const app = new Hono();

    //------------------------------------------------------------------------------------------------------------------
    // Gate (before the auth mount)
    //------------------------------------------------------------------------------------------------------------------

    if(auth)
    {
        app.use('*', async (ctx, next) =>
        {
            if(targetsGatedAuthSurface(new URL(ctx.req.url).pathname))
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
        app.route('/api', createAccessTokenRoutes(sessions, new AccessTokenManager(auth)));

        if(services)
        {
            app.route('/api', createSetupRoutes(services.setup));
            app.route('/api', createAdminStatusRoutes(sessions, services.adminStatus));
            app.route('/api', createBlobRoutes(sessions, services.blobs, services.mediaTags));
            app.route('/api', createUploadRoutes(sessions, services.blobs, services.mediaTags));
            app.route('/api', createNodeRoutes(sessions, services.nodes));
            app.route('/api', createSearchRoutes(sessions, services.nodes));
            app.route('/api', createMeRoutes(sessions, services.nodes));
            app.route('/api', createUserRoutes(sessions, services.users));
            app.route('/api', createAvatarRoutes(sessions, services.avatars, services.nodes));
            app.route('/api', createShareRoutes(sessions, services.shares));
            app.route('/api', createAccessRequestRoutes(sessions, services.shares));
            app.route('/api', createDownloadRoutes(sessions, services.publicLinks));
            app.route('/api', createPublicLinkRoutes(sessions, services.publicLinks));
            app.route('/api', createDeletionOfferRoutes(sessions, services.deletionOffers));
            app.route('/d', createDirectRoutes(services.publicLinks));
        }

        mountOpenApiDocs(app);
    }

    app.route('/api', health);

    //------------------------------------------------------------------------------------------------------------------
    // Static client -- the production single-image mode: hashed assets straight from the built client, and the SPA
    // history fallback for everything that is not an API or direct-link path. /api and /d keep their JSON 404s: a
    // fallback that served index.html for a mistyped API route or a dead /d token would turn every such error into
    // a confusing 200. The vue-router owns everything else.
    //------------------------------------------------------------------------------------------------------------------

    const clientDist = options.clientDist;
    if(clientDist !== undefined)
    {
        app.use('*', serveStatic({ root: clientDist }));

        app.get('*', async (ctx) =>
        {
            const path = new URL(ctx.req.url).pathname;
            if(path === '/api' || path.startsWith('/api/') || path === '/d' || path.startsWith('/d/'))
            {
                return ctx.json({ error: 'Not Found' }, 404);
            }

            return ctx.html(await readFile(join(clientDist, 'index.html'), 'utf8'));
        });
    }

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

    await initialize(handle, auth);
    await seedDefaultBackend(handle, config);

    const blob = new BlobRA(handle);
    const nodeRA = new NodeRA(handle);
    const shareRA = new ShareRA(handle);
    const userRA = new UserRA(handle);
    const tracker = new LastRunTracker();
    const blobs = new BlobManager({ handle, blob, uploadMaxBytes: config.UPLOAD_MAX_BYTES });
    const mediaTags = new MediaTagManager({ blob, tags: new MediaTagsRA(handle) });
    const avatars = new AvatarManager({ handle, blob, avatarMaxBytes: config.AVATAR_MAX_BYTES });
    const nodes = new NodeManager(handle, nodeRA, blob, config.GC_GRACE_DAYS * MS_PER_DAY, config.TRASH_PURGE_DAYS);
    const shares = new ShareManager(handle, nodeRA, shareRA, userRA);
    const users = new UserManager(userRA);
    const deletionOffers = new DeletionOfferManager(handle, nodes);
    const adminStatus = new StatusManager(blob, tracker);
    const setup = new SetupManager({
        auth,
        handle,
        users: userRA,
        operatorToken: config.FILESHED_SETUP_TOKEN ?? null,
    });
    await setup.announce(config.BASE_URL);

    const publicLinks = new PublicLinkManager(
        nodeRA,
        blob,
        new PublicLinkRA(handle),
        (userID, nodeID) => shareRA.effectiveRole(userID, nodeID)
    );

    const sweepIntervalMs = config.GC_INTERVAL_MINUTES * MS_PER_MINUTE;
    const stopGc = startGcTimer(
        { handle, blob, graceMs: config.GC_GRACE_DAYS * MS_PER_DAY },
        sweepIntervalMs,
        (summary) => tracker.recordGc(summary)
    );
    const stopTrashPurge = startTrashPurgeTimer(
        { nodes: nodeRA, purger: nodes, graceMs: config.TRASH_PURGE_DAYS * MS_PER_DAY },
        sweepIntervalMs,
        (summary) => tracker.recordTrashPurge(summary)
    );
    const stopSweeps = blobs.startSweeps();
    const stopMediaTags = startMediaTagTimer(mediaTags, sweepIntervalMs, MEDIA_TAG_SWEEP_BATCH);

    const shutdown = () : void =>
    {
        stopGc();
        stopTrashPurge();
        stopSweeps();
        stopMediaTags();
    };

    const services = {
        blobs, mediaTags, avatars, nodes, shares, publicLinks, deletionOffers, adminStatus, users, setup,
    };

    return { app: createApp(auth, services, { clientDist: config.CLIENT_DIST }), config, shutdown };
}

//----------------------------------------------------------------------------------------------------------------------

export default createApp();

//----------------------------------------------------------------------------------------------------------------------
