//----------------------------------------------------------------------------------------------------------------------
// FileShed Server Entry
//
// Dual-role: run directly (node server.ts) it boots and serves; imported (the @hono/vite-dev-server entry) it only
// boots and default-exports the app -- import.meta.main distinguishes the two. app.ts's own default export stays
// boot-free for the specs.
//----------------------------------------------------------------------------------------------------------------------

import { serve } from '@hono/node-server';

// App
import { bootApp } from './app.ts';

// Utils
import { getLogger } from './utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

// The Vite dev server re-executes this module in the same process when server files change. Each boot starts the
// sweep timers, so the previous boot's must be stopped first -- otherwise every reload leaks a ticking set and the
// sweeps fire at fractions of their interval.
type BootGlobal = typeof globalThis & { __fileshedShutdown ?: () => void };
const bootGlobal = globalThis as BootGlobal;

bootGlobal.__fileshedShutdown?.();
const { app, config, shutdown } = await bootApp();
bootGlobal.__fileshedShutdown = shutdown;

if(import.meta.main)
{
    const logger = getLogger('server');

    serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) =>
    {
        logger.info({ host: info.address, port: info.port }, 'FileShed server listening');
    });
}

//----------------------------------------------------------------------------------------------------------------------

export default app;

//----------------------------------------------------------------------------------------------------------------------
