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

import {
    MEDIA_TAG_SWEEP_BATCH,
    MS_PER_DAY,
    MS_PER_MINUTE,
    type SocialProviderID,
    providerSettingKeys,
} from '@fileshed/core';

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
import { createAdminEmailRoutes } from './routes/adminEmail.ts';
import { createAdminSettingsRoutes } from './routes/adminSettings.ts';
import { createBrandingRoutes } from './routes/branding.ts';
import { createSetupRoutes } from './routes/setup.ts';
import { createShareRoutes } from './routes/shares.ts';
import { createUploadRoutes } from './routes/uploads.ts';
import { createUserRoutes } from './routes/users.ts';

// Resource Access
import {
    type Auth,
    type ProviderBootValues,
    activeProviderIDs,
    createAuth,
    providerValuesFromConfig,
} from './resource-access/auth.ts';
import { createDatabase } from './resource-access/database/database.ts';
import { initialize } from './resource-access/boot.ts';
import { seedDefaultBackend } from './resource-access/database/seeds.ts';
import { BlobRA } from './resource-access/blob/index.ts';
import { NodeRA } from './resource-access/nodes/node.ts';
import { MailRA } from './resource-access/mail/index.ts';
import { MediaTagsRA } from './resource-access/mediaTags/index.ts';
import { SettingsRA } from './resource-access/settings/index.ts';
import { PublicLinkRA } from './resource-access/publicLinks/index.ts';
import { ShareRA } from './resource-access/shares/index.ts';
import { UserRA } from './resource-access/users/index.ts';

// Managers
import { AccessTokenManager } from './managers/accessToken.ts';
import { AdminManager } from './managers/admin.ts';
import { AvatarManager } from './managers/avatar.ts';
import { BlobManager } from './managers/blob.ts';
import { DeletionOfferManager } from './managers/deletionOffer.ts';
import { MailManager } from './managers/mail.ts';
import { MediaTagManager, startMediaTagTimer } from './managers/mediaTags.ts';
import { NodeManager } from './managers/node.ts';
import { PublicLinkManager } from './managers/publicLink.ts';
import { ShareManager } from './managers/share.ts';
import { SessionManager } from './managers/session.ts';
import { SettingsManager } from './managers/settings.ts';
import { BrandingManager } from './managers/branding.ts';
import { SetupManager } from './managers/setup.ts';
import { UserManager } from './managers/user.ts';
import { StatusManager } from './managers/status.ts';
import { LastRunTracker } from './managers/lastRun.ts';
import { mapManagerError } from './managers/errors.ts';
import { startGcTimer } from './managers/gc.ts';
import { startTrashPurgeTimer } from './managers/trashPurge.ts';

// Utils
import { type Config, loadConfig } from './utils/config.ts';
import { SecretBox } from './utils/secretBox.ts';
import { getLogger } from './utils/logger.ts';
import { VERSION } from './utils/version.ts';

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

const signUpPrefix = '/api/auth/sign-up';

function normalizeAuthPath(pathname : string) : string
{
    let path = pathname;
    try { path = decodeURIComponent(pathname); }
    catch { /* malformed encoding: fall through with the raw path, which better-auth would 404 anyway */ }

    return path.replace(/\/{2,}/g, '/').toLowerCase();
}

export function targetsGatedAuthSurface(pathname : string) : boolean
{
    const path = normalizeAuthPath(pathname);

    return gatedAuthPrefixes.some((prefix) => path === prefix || path.startsWith(`${ prefix }/`));
}

export function targetsSignUpSurface(pathname : string) : boolean
{
    const path = normalizeAuthPath(pathname);

    return path === signUpPrefix || path.startsWith(`${ signUpPrefix }/`);
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
    settings : SettingsManager;
    branding : BrandingManager;
    admins : AdminManager;
    mail : MailManager;

    // The OAuth providers frozen into this process's auth instance at boot, for /api/instance.
    providers : SocialProviderID[];
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
            const pathname = new URL(ctx.req.url).pathname;

            if(targetsGatedAuthSurface(pathname))
            {
                return ctx.json({ error: 'Not Found' }, 404);
            }

            // The sign-up switch, checked live per request so flipping it needs no restart. The first-run wizard is
            // unaffected: it creates its admin through a server-side auth.api call, which never traverses HTTP.
            if(services && targetsSignUpSurface(pathname)
                && !(await services.settings.booleanValue('SIGN_UP_ENABLED', true)))
            {
                return ctx.json({ error: 'Sign-ups are disabled on this instance.' }, 403);
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
        // Auth-only compositions (no services) still get the admin surface; with no node store to charge against,
        // every account truthfully reports zero usage.
        app.route('/api', createAdminRoutes(
            sessions,
            services?.admins ?? new AdminManager({ auth, usage: async () => new Map() })
        ));
        app.route('/api', createAccessTokenRoutes(sessions, new AccessTokenManager(auth)));

        if(services)
        {
            app.route('/api', createSetupRoutes(services.setup, {
                signUpEnabled: () => services.settings.booleanValue('SIGN_UP_ENABLED', true),
                emailEnabled: () => services.mail.isConfigured(),
                // Read live per request: a rename or mode change applies on the next page load, no restart. A
                // corrupt theme row never throws (toInstanceTheme collapses it); a dead database fails the whole
                // /api/instance alongside the setup check, which is the honest answer for a broken instance.
                branding: async () =>
                {
                    const [ name, theme, logo ] = await Promise.all([
                        services.settings.value('INSTANCE_NAME'),
                        services.branding.theme(),
                        services.branding.logoSha(),
                    ]);

                    return {
                        instanceName: typeof name === 'string' && name !== '' ? name : 'FileShed',
                        mode: theme.mode,
                        forcedMode: theme.forcedMode,
                        logo,
                    };
                },
                providers: services.providers,
            }));
            app.route('/api', createAdminSettingsRoutes(sessions, services.settings));
            app.route('/api', createBrandingRoutes(sessions, services.branding));
            app.route('/api', createAdminEmailRoutes(sessions, services.mail));
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
// must call it, or sweeps keep firing against a torn-down database. Known dev-only wart: the Vite runtime
// re-imports the entry on server-file changes without disposing the old module, so sweep timers stack across
// reloads until the dev server is bounced -- harmless (sweeps are idempotent) beyond log noise.
export async function bootApp() : Promise<{ app : Hono; config : Config; shutdown : () => void }>
{
    const config = loadConfig();
    const handle = createDatabase(config);
    const startedAt = new Date();
    const settingsRA = new SettingsRA(handle);
    const settings = new SettingsManager({
        settings: settingsRA,
        config,
        box: new SecretBox(config.AUTH_SECRET),
        startedAt,
    });
    const mail = new MailManager({ settings, mail: new MailRA() });

    // better-auth freezes requireEmailVerification and the OAuth providers at construction, and construction
    // happens before the migrations -- the boot-tolerant reads answer the config defaults on a first boot with no
    // settings table. providerValues also feeds /api/instance, so the sign-in buttons mirror exactly what this
    // process registered.
    const configProviderValues = providerValuesFromConfig(config);
    const providerValues : ProviderBootValues = Object.fromEntries(await Promise.all(
        providerSettingKeys.map(async (key) =>
            [ key, await settings.stringValueAtBoot(key, configProviderValues[key] ?? null) ] as const)
    ));
    const auth = createAuth(handle, config, {
        mail,
        requireEmailVerification: await settings.booleanValueAtBoot(
            'EMAIL_VERIFICATION_REQUIRED',
            config.EMAIL_VERIFICATION_REQUIRED
        ),
        providerValues,
    });

    await initialize(handle, auth);
    await seedDefaultBackend(handle, config);

    const blob = new BlobRA(handle);
    const nodeRA = new NodeRA(handle);
    const shareRA = new ShareRA(handle);
    const userRA = new UserRA(handle);
    const tracker = new LastRunTracker();

    // The caps are closures over the settings manager, resolved per use: an admin override applies to the very
    // next request, and with no override each supplier answers the config value it names.
    const uploadMaxBytes = () : Promise<number> => settings.numberValue('UPLOAD_MAX_BYTES', config.UPLOAD_MAX_BYTES);
    const avatarMaxBytes = () : Promise<number> => settings.numberValue('AVATAR_MAX_BYTES', config.AVATAR_MAX_BYTES);
    const trashPurgeDays = () : Promise<number> => settings.numberValue('TRASH_PURGE_DAYS', config.TRASH_PURGE_DAYS);

    const blobs = new BlobManager({ handle, blob, uploadMaxBytes });
    const mediaTags = new MediaTagManager({ blob, tags: new MediaTagsRA(handle) });
    const avatars = new AvatarManager({ handle, blob, avatarMaxBytes });
    const branding = new BrandingManager({ settings: settingsRA, config, handle, blob, maxBytes: avatarMaxBytes });
    const nodes = new NodeManager(handle, nodeRA, blob, config.GC_GRACE_DAYS * MS_PER_DAY, trashPurgeDays);
    const shares = new ShareManager(handle, nodeRA, shareRA, userRA);
    const users = new UserManager(userRA);
    const deletionOffers = new DeletionOfferManager(handle, nodes);
    const providers = activeProviderIDs(providerValues);
    const adminStatus = new StatusManager({
        blob,
        nodes: nodeRA,
        users: userRA,
        shares: shareRA,
        tracker,
        version: VERSION,
        databaseKind: handle.kind,
        startedAt,
        activeProviders: providers.length,
        emailEnabled: () => mail.isConfigured(),
        signUpEnabled: () => settings.booleanValue('SIGN_UP_ENABLED', true),
    });
    const admins = new AdminManager({ auth, usage: (ownerIDs) => nodeRA.ownedBytesByOwner(ownerIDs) });

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
        { nodes: nodeRA, purger: nodes, graceMs: async () => await trashPurgeDays() * MS_PER_DAY },
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
        blobs,
        mediaTags,
        avatars,
        nodes,
        shares,
        publicLinks,
        deletionOffers,
        adminStatus,
        users,
        setup,
        settings,
        branding,
        admins,
        mail,
        providers,
    };

    return { app: createApp(auth, services, { clientDist: config.CLIENT_DIST }), config, shutdown };
}

//----------------------------------------------------------------------------------------------------------------------

export default createApp();

//----------------------------------------------------------------------------------------------------------------------
