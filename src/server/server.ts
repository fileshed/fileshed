//----------------------------------------------------------------------------------------------------------------------
// FileShed Server Entry
//
// Dual-role: run directly (node server.ts) it boots and serves; imported (the @hono/vite-dev-server entry) it only
// boots and default-exports the app -- import.meta.main distinguishes the two. app.ts's own default export stays
// boot-free for the specs.
//
// `--api-reference` is the one thing this entry decides. It is a command-line flag rather than a setting on purpose:
// a deployment never serves the interactive reference, and the way to guarantee that is for the switch to live
// somewhere a configuration file cannot reach. An environment variable is a line that gets copied from one deployment
// to the next; an argument is something a person typed at the process in front of them.
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

const apiReference = process.argv.includes('--api-reference');

bootGlobal.__fileshedShutdown?.();
const { app, config, shutdown } = await bootApp({ apiReference });
bootGlobal.__fileshedShutdown = shutdown;

if(import.meta.main)
{
    const logger = getLogger('server');

    // Said out loud, because a surface that offers to call this API from an anonymous page should never be a surprise
    // to whoever is reading the log.
    if(apiReference)
    {
        logger.warn('The interactive API reference is mounted at /api/docs. Never run a deployment with this flag.');
    }

    serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) =>
    {
        logger.info({ host: info.address, port: info.port }, 'FileShed server listening');
    });
}

//----------------------------------------------------------------------------------------------------------------------

export default app;

//----------------------------------------------------------------------------------------------------------------------
