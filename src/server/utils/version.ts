//----------------------------------------------------------------------------------------------------------------------
// Instance Version
//
// What FileShed reports itself as. Deliberately the WORKSPACE ROOT's version, not @fileshed/server's -- the instance
// ships as one product, and the root manifest is the thing that gets tagged. Read once at module load: nothing
// serving a request may touch the filesystem for it, and it cannot change while the process lives.
//----------------------------------------------------------------------------------------------------------------------

import { createRequire } from 'node:module';

//----------------------------------------------------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const manifest = require('../../../package.json') as { version : string };

export const VERSION = manifest.version;

//----------------------------------------------------------------------------------------------------------------------
