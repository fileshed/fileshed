//----------------------------------------------------------------------------------------------------------------------
// Scalar Bundle Asset
//
// The API reference UI's script, copied into the client build so the server can serve it from its own origin instead of
// a CDN. It has nothing to do with the client bundle and is never imported by it -- but the built client is the static
// tree a packaged deployment ships, and that tree is the only place the server can still find this file once
// node_modules is gone.
//----------------------------------------------------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';

//----------------------------------------------------------------------------------------------------------------------

// Matches BUNDLE_PATH in the server's openapi routes, which is what the reference page asks for.
const OUTPUT_PATH = 'scalar/standalone.js';

//----------------------------------------------------------------------------------------------------------------------

export function scalarBundle() : Plugin
{
    return {
        name: 'fileshed:scalar-bundle',

        async generateBundle()
        {
            // import.meta.resolve answers the package's module entry; the browser build sits beside it.
            const entry = import.meta.resolve('@scalar/api-reference');
            const source = await readFile(fileURLToPath(new URL('./browser/standalone.js', entry)));

            this.emitFile({ type: 'asset', fileName: OUTPUT_PATH, source });
        },
    };
}

//----------------------------------------------------------------------------------------------------------------------
