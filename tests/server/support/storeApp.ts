//----------------------------------------------------------------------------------------------------------------------
// Store App Spec Support
//
// The composed app over a database of its own and a storage root in a temp directory with the default backend seeded,
// for the specs that move real bytes. Requests take the same pipeline production does: the hardening, the body cap,
// the auth gate and the error mapping all come from createApp.
//----------------------------------------------------------------------------------------------------------------------

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Resource Access
import { type Auth, authOptions, createAuth } from '@server/resource-access/auth/instance.ts';
import { BlobRA } from '@server/resource-access/blob/index.ts';
import type { DatabaseHandle } from '@server/resource-access/database/database.ts';
import { seedDefaultBackend } from '@server/resource-access/blob/seeds.ts';

// App
import { migrateDatabase } from '@server/boot.ts';
import { createApp } from '@server/clients/http/app.ts';
import type { AppServices } from '@server/services.ts';

// Utils
import type { Config } from '@server/utils/config.ts';

// Support
import { type BootedApp, TEST_AUTH_SECRET, composeTestServices, testConfig } from '../auth/support.ts';
import { openTestDatabase } from './database.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface BootedStoreApp extends BootedApp
{
    services : AppServices;
    blob : BlobRA;
    backendID : string;
    storageRoot : string;
    cleanup : () => Promise<void>;
}

// What a spec has to build a replacement manager from.
export interface StoreParts
{
    config : Config;
    handle : DatabaseHandle;
    auth : Auth;
    blob : BlobRA;

    // The graph as composed before this spec's swaps, for a replacement that needs a collaborator.
    composed : AppServices;
}

export interface StoreAppOptions
{
    config ?: Partial<Config>;

    // Managers a spec swaps in over the composed ones: a sweep it can hold open, a supplier it moves between requests.
    services ?: (parts : StoreParts) => Partial<AppServices>;
}

//----------------------------------------------------------------------------------------------------------------------

export async function bootStoreApp(options : StoreAppOptions = {}) : Promise<BootedStoreApp>
{
    const storageRoot = await mkdtemp(join(tmpdir(), 'fileshed-store-'));
    const { config, handle, dispose } = await openTestDatabase(testConfig({
        STORAGE_ROOT: storageRoot,
        ...options.config,
    }));

    await migrateDatabase(handle, authOptions(handle, config, TEST_AUTH_SECRET));
    const auth = createAuth(handle, config, TEST_AUTH_SECRET);
    const backendID = await seedDefaultBackend(handle, config);
    const blob = new BlobRA(handle);

    const composed = composeTestServices(auth, handle, config);
    const services : AppServices = { ...composed, ...options.services?.({ config, handle, auth, blob, composed }) };

    return {
        config,
        handle,
        auth,
        app: createApp({ auth, services }),
        services,
        blob,
        backendID,
        storageRoot,
        cleanup: async () =>
        {
            await dispose();
            await rm(storageRoot, { recursive: true, force: true });
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------
