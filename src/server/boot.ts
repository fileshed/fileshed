//----------------------------------------------------------------------------------------------------------------------
// Boot
//
// The one way from an empty process to a serving app, in this order: config, database, secret, migrations, auth, the
// service graph, then the recurring jobs.
//----------------------------------------------------------------------------------------------------------------------

import type { Hono } from 'hono';

import {
    DEFAULT_UPLOAD_CHUNK_BYTES,
    EXPIRY_PRUNE_INTERVAL_MS,
    MEDIA_TAG_SWEEP_BATCH,
    MS_PER_MINUTE,
    STAGED_UPLOADS_SWEEP_INTERVAL_MS,
    providerSettingKeys,
} from '@fileshed/core';

// App
import { createApp } from './clients/http/app.ts';
import { type AppServices, composeServices } from './services.ts';

// Middleware
import { securityMiddleware } from './clients/http/middleware/index.ts';

// Resource Access
import {
    type AuthOptions,
    type ProviderBootValues,
    activeProviderIDs,
    authOptions,
    createAuth,
    providerValuesFromConfig,
} from './resource-access/auth/instance.ts';
import { migrateAuthSchema } from './resource-access/auth/migrations.ts';
import { type DatabaseHandle, createDatabase } from './resource-access/database/database.ts';
import { migrateToLatest } from './resource-access/database/migrator.ts';
import { seedDefaultBackend } from './resource-access/blob/seeds.ts';
import { MailRA } from './resource-access/mail/index.ts';
import { SettingsRA } from './resource-access/settings/index.ts';

// Managers
import { managedAuthSecretFile, resolveAuthSecret } from './managers/authSecret.ts';
import { MailManager } from './managers/mail.ts';
import { SettingsManager } from './managers/settings.ts';
import { TimerManager } from './managers/timers.ts';

// Utils
import { type Config, loadConfig } from './utils/config.ts';
import { getLogger } from './utils/logger.ts';
import { SecretBox } from './utils/secretBox.ts';
import { resolveBuildInfo } from './utils/version.ts';

//----------------------------------------------------------------------------------------------------------------------

const logger = getLogger('server');

export interface BootOptions
{
    // Passed through to createApp. server.ts reads it from the command line.
    apiReference ?: boolean;
}

export interface BootedServer
{
    app : Hono;
    config : Config;

    // Stops the timers, waits out any sweep still running, then closes the database handle. server.ts calls it before
    // booting again when Vite re-executes the entry.
    shutdown : () => Promise<void>;
}

//----------------------------------------------------------------------------------------------------------------------

// The three sweeps that read the database run on the configured interval. Every job but the expiry prune also runs at
// boot, and that pass matters more than it looks: a deployment restarted more often than its interval would otherwise
// never sweep at all, and the admin status page would report an eternal "never".
function registerTimers(timers : TimerManager, services : AppServices, config : Config) : void
{
    const sweepIntervalMs = config.GC_INTERVAL_MINUTES * MS_PER_MINUTE;

    timers.register({
        name: 'sweep.gc',
        intervalMs: sweepIntervalMs,
        immediate: true,
        run: () => services.sweeps.runScheduled('gc'),
    });

    timers.register({
        name: 'sweep.trashPurge',
        intervalMs: sweepIntervalMs,
        immediate: true,
        run: () => services.sweeps.runScheduled('trashPurge'),
    });

    // Accounts whose deletion window has run out. On the sweep interval like the other two database sweeps: the
    // window is measured in days, so an hour either side of due is not a promise anyone made.
    timers.register({
        name: 'sweep.accountDeletion',
        intervalMs: sweepIntervalMs,
        immediate: true,
        run: () => services.sweeps.runScheduled('accountDeletion'),
    });

    // The staged-upload sweep comes round far more often, on a cadence of its own: it only reads the staging directory,
    // and what it reclaims is disk rather than rows.
    timers.register({
        name: 'sweep.stagedUploads',
        intervalMs: STAGED_UPLOADS_SWEEP_INTERVAL_MS,
        immediate: true,
        run: () => services.sweeps.runScheduled('stagedUploads'),
    });

    // A library uploaded before extraction existed should become searchable when the server comes up, not an hour
    // later. Each pass handles one batch, so a busy one leaves the rest of the worklist for the next tick.
    timers.register({
        name: 'mediaTags.backfill',
        intervalMs: sweepIntervalMs,
        immediate: true,
        run: () => services.mediaTags.runScheduled(MEDIA_TAG_SWEEP_BATCH),
    });

    // Nothing has been issued yet at boot, so there is nothing for the first prune to find.
    timers.register({
        name: 'blobs.expiryPrune',
        intervalMs: EXPIRY_PRUNE_INTERVAL_MS,
        immediate: false,
        run: () => services.blobs.pruneExpired(),
    });
}

//----------------------------------------------------------------------------------------------------------------------

// Brings the database from empty to ready. better-auth's tables come first because the app tables carry FKs to user.id,
// and all of it runs before any auth instance exists: an instance validates the schema as it is constructed, so one
// built over an unmigrated database reports the tables it is about to get as missing.
export async function migrateDatabase(handle : DatabaseHandle, options : AuthOptions) : Promise<void>
{
    await migrateAuthSchema(handle, options);
    await migrateToLatest(handle.db, handle.kind);
}

//----------------------------------------------------------------------------------------------------------------------

export async function bootApp(options : BootOptions = {}) : Promise<BootedServer>
{
    const config = loadConfig();
    const handle = createDatabase(config);
    const settingsRA = new SettingsRA(handle);

    // Before every migration: better-auth's own migrator runs off auth options this secret is part of, and the
    // SecretBox that seals stored settings derives its key from the same value.
    const authSecret = await resolveAuthSecret({
        managedFile: managedAuthSecretFile(config),
        configuredFile: config.AUTH_SECRET_FILE ?? null,
        environment: config.AUTH_SECRET ?? null,
        previous: config.AUTH_SECRET_PREVIOUS ?? null,
        discardSealedSecrets: config.FILESHED_DISCARD_SEALED_SECRETS,
        settings: settingsRA,
    });

    const startedAt = new Date();
    const settings = new SettingsManager({
        handle,
        config,
        box: new SecretBox(authSecret),
        startedAt,
    });
    const mail = new MailManager({ settings, mail: new MailRA() });

    // These options only have to describe the schema, which the boot-read values below do not touch.
    await migrateDatabase(handle, authOptions(handle, config, authSecret));
    await seedDefaultBackend(handle, config);

    // better-auth freezes requireEmailVerification and the OAuth providers at construction, so they are read here,
    // between the migrations and the instance. providerValues also feeds /api/instance, so the sign-in buttons
    // mirror exactly what this process registered.
    const configProviderValues = providerValuesFromConfig(config);
    const providerValues : ProviderBootValues = Object.fromEntries(await Promise.all(
        providerSettingKeys.map(async (key) =>
            [ key, await settings.optionalStringValue(key, configProviderValues[key] ?? null) ] as const)
    ));
    const auth = createAuth(handle, config, authSecret, {
        mail,
        requireEmailVerification: await settings.booleanValue(
            'EMAIL_VERIFICATION_REQUIRED',
            config.EMAIL_VERIFICATION_REQUIRED
        ),
        providerValues,
    });

    // A tuned chunk size is worth one line in the boot log: it changes how every client cuts its uploads, and an
    // operator who set it needs to see the instance agreed. The default speaks for itself.
    if(config.UPLOAD_CHUNK_BYTES !== DEFAULT_UPLOAD_CHUNK_BYTES)
    {
        logger.info({ chunkBytes: config.UPLOAD_CHUNK_BYTES }, 'Upload chunk size overridden');
    }

    const services = composeServices({
        config,
        handle,
        auth,
        settings,
        mail,
        providers: activeProviderIDs(providerValues),
        build: resolveBuildInfo(),
        startedAt,
    });
    await services.setup.announce(config.BASE_URL);

    const timers = new TimerManager();
    registerTimers(timers, services, config);
    timers.startTimers();

    return {
        app: createApp({ auth, services }, {
            clientDist: config.CLIENT_DIST,
            security: securityMiddleware(config),
            apiReference: options.apiReference,
        }),
        config,
        shutdown: async () =>
        {
            timers.stopTimers();
            await timers.whenIdle();
            await handle.db.destroy();
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------
