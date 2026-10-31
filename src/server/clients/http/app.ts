//----------------------------------------------------------------------------------------------------------------------
// FileShed Server
//
// A no-arg createApp() (the default export) mounts only the public routes -- no auth instance, no admin surface. It
// exists so the health/smoke path is exercisable without a database or secret.
//----------------------------------------------------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Hono, type MiddlewareHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

// Routes
import health from './routes/health.ts';
import { createAccessTokenRoutes } from './routes/accessTokens.ts';
import { createAdminRoutes, createAdminRuntimeRoutes } from './routes/admin.ts';
import { createAvatarRoutes } from './routes/avatars.ts';
import { createBlobRoutes } from './routes/blobs.ts';
import { createCredentialRoutes } from './routes/credentials.ts';
import { errorToResponse } from './utils/errorResponse.ts';
import { createMeRoutes } from './routes/me.ts';
import { createAccessRequestRoutes } from './routes/accessRequests.ts';
import { createDeletionOfferRoutes } from './routes/deletionOffers.ts';
import { createDirectRoutes } from './routes/direct.ts';
import { createArchiveRoutes } from './routes/archives.ts';
import { createDownloadRoutes } from './routes/downloads.ts';
import { createNodeRoutes } from './routes/nodes.ts';
import { mountAPIReference, mountOpenAPISpec } from './routes/openapi.ts';
import { createPublicLinkRoutes } from './routes/links.ts';
import { createSearchRoutes } from './routes/search.ts';
import { createAdminEmailRoutes } from './routes/adminEmail.ts';
import { createAdminSettingsRoutes } from './routes/adminSettings.ts';
import { createBrandingRoutes } from './routes/branding.ts';
import { createSetupRoutes } from './routes/setup.ts';
import { createShareRoutes } from './routes/shares.ts';
import { createUploadRoutes } from './routes/uploads.ts';
import { createUserRoutes } from './routes/users.ts';
import { createVersionRoutes } from './routes/version.ts';

// Middleware
import { createAuthGate } from './middleware/authGate.ts';
import { createBodyLimit } from './middleware/bodyLimit.ts';
import { createResponseHardening } from './middleware/hardening.ts';

// Resource Access
import type { Auth } from '../../resource-access/auth/instance.ts';

// Services
import type { AppServices } from '../../services.ts';

// Utils
import { getLogger } from '../../utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('server');

// Auth and the service graph arrive together: every API route but health needs a session, and every session-backed
// route needs a manager.
export interface AppComposition
{
    auth : Auth;
    services : AppServices;
}

export interface AppOptions
{
    // The built client's directory (resolved from the working directory). Present only in production, where this
    // process serves the SPA alongside the API; development leaves the client to Vite.
    clientDist ?: string;

    // Request throttling and the origin check, built from config by the caller. Absent leaves both off, which is what
    // the specs want.
    security ?: MiddlewareHandler[];

    // Whether to mount the interactive API reference. Deliberately not a config key: an environment variable is a line
    // in a file that gets copied between deployments, and this is a thing you should only ever get by asking for it on
    // the command line of the process you are standing in front of.
    apiReference ?: boolean;
}

export function createApp(composition ?: AppComposition, options : AppOptions = {}) : Hono
{
    const app = new Hono();

    //------------------------------------------------------------------------------------------------------------------
    // Middleware
    //------------------------------------------------------------------------------------------------------------------

    app.use('*', createResponseHardening());

    // After the hardening wrapper so a refusal still carries those headers, and before the auth gate because the
    // credential budget exists to protect exactly what the gate handles. Hono only runs middleware registered ahead
    // of the route it matches, so this ordering is the whole of whether any of it runs at all.
    for(const middleware of options.security ?? []) { app.use('*', middleware); }

    app.use('/api/*', createBodyLimit());

    //------------------------------------------------------------------------------------------------------------------
    // API Routes
    //------------------------------------------------------------------------------------------------------------------

    if(composition)
    {
        const { auth, services } = composition;
        const { sessions } = services;

        // Ahead of the auth mount, which is what it guards.
        app.use('*', createAuthGate(() => services.settings.booleanValue('SIGN_UP_ENABLED', true)));
        app.on([ 'POST', 'GET' ], '/api/auth/*', (ctx) => auth.handler(ctx.req.raw));
        app.route('/api', createAdminRoutes(sessions, services.admins));
        app.route('/api', createAccessTokenRoutes(sessions, services.accessTokens));
        app.route('/api', createVersionRoutes(sessions, services.build));
        app.route('/api', createSetupRoutes(services.setup, {
            signUpEnabled: () => services.settings.booleanValue('SIGN_UP_ENABLED', true),
            emailEnabled: () => services.mail.isConfigured(),
            // Read live per request: a rename or mode change applies on the next page load, no restart. A corrupt theme
            // row never throws (toInstanceTheme collapses it); a dead database fails the whole /api/instance alongside
            // the setup check, which is the honest answer for a broken instance.
            branding: async () =>
            {
                const [ instanceName, theme, logo ] = await Promise.all([
                    services.settings.instanceName(),
                    services.branding.theme(),
                    services.branding.logoSha(),
                ]);

                return {
                    instanceName,
                    mode: theme.mode,
                    forcedMode: theme.forcedMode,
                    logo,
                };
            },
            limits: services.limits,
            providers: services.providers,
        }));
        app.route('/api', createAdminSettingsRoutes(sessions, services.settings));
        app.route('/api', createBrandingRoutes(sessions, services.branding));
        app.route('/api', createAdminEmailRoutes(sessions, services.mail));
        app.route('/api', createAdminRuntimeRoutes(sessions, services.adminStatus, services.sweeps));
        app.route('/api', createBlobRoutes(sessions, services.blobs));
        app.route('/api', createUploadRoutes(sessions, services.blobs));
        app.route('/api', createNodeRoutes(sessions, services.nodes));
        app.route('/api', createSearchRoutes(sessions, services.nodes));
        app.route('/api', createMeRoutes(sessions, services.users, services.accountDeletions));
        app.route('/api', createCredentialRoutes(sessions, services.credentials));
        app.route('/api', createUserRoutes(sessions, services.users));
        app.route('/api', createAvatarRoutes(sessions, services.avatars, services.users));
        app.route('/api', createShareRoutes(sessions, services.shares));
        app.route('/api', createAccessRequestRoutes(sessions, services.shares));
        app.route('/api', createDownloadRoutes(sessions, services.publicLinks));
        app.route('/api', createArchiveRoutes(sessions, services.archives));
        app.route('/api', createPublicLinkRoutes(sessions, services.publicLinks));
        app.route('/api', createDeletionOfferRoutes(sessions, services.deletionOffers));
        app.route('/d', createDirectRoutes(services.publicLinks));

        mountOpenAPISpec(app, services.build.version);

        // Never from a deployment. The reference is a page that loads a bundle and offers to call this API from it,
        // and an instance has no business serving one anonymously; a developer asks for it explicitly at launch.
        if(options.apiReference === true) { mountAPIReference(app); }
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
        const response = errorToResponse(error);
        if(response)
        {
            return ctx.json(response.body, response.status, response.headers);
        }

        logger.error({ err: error }, 'Unhandled error');
        return ctx.json({ error: 'Internal Server Error' }, 500);
    });

    return app;
}

//----------------------------------------------------------------------------------------------------------------------

export default createApp();

//----------------------------------------------------------------------------------------------------------------------
