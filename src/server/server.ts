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

const { app, config } = await bootApp();

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
