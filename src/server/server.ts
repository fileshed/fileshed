//----------------------------------------------------------------------------------------------------------------------
// FileShed Server Entry
//----------------------------------------------------------------------------------------------------------------------

import { serve } from '@hono/node-server';

// App
import app from './app.ts';

// Utils
import { loadConfig } from './utils/config.ts';
import { getLogger } from './utils/logger.ts';

//----------------------------------------------------------------------------------------------------------------------

const config = loadConfig();
const logger = getLogger('server');

//----------------------------------------------------------------------------------------------------------------------

serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) =>
{
    logger.info({ host: info.address, port: info.port }, 'FileShed server listening');
});

//----------------------------------------------------------------------------------------------------------------------
