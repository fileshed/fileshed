//----------------------------------------------------------------------------------------------------------------------
// Vitest Configuration — End-to-End
//
// A separate project from the default suite: these specs spawn a real server process per file, so they are slow and
// belong behind their own `test:e2e` script, never in the fast `npm test`. One server per file (beforeAll/afterAll);
// files run in parallel, kept safe by distinct ports and temp dirs (tests/e2e/support.ts). The aliases mirror the main
// config so specs resolve @server/@fileshed/core the same way the source does.
//----------------------------------------------------------------------------------------------------------------------

import path from 'node:path';
import { defineConfig } from 'vitest/config';

//----------------------------------------------------------------------------------------------------------------------

export default defineConfig({
    resolve: {
        alias: {
            '@server': path.resolve(__dirname, 'src/server'),
            '@fileshed/core': path.resolve(__dirname, 'packages/core/src'),
        },
    },
    test: {
        name: 'e2e',
        include: [ 'tests/e2e/**/*.spec.ts' ],
        environment: 'node',
        // Clears temp dirs stranded by a previously killed run (tests/e2e/globalSetup.ts).
        globalSetup: [ './tests/e2e/globalSetup.ts' ],
        // Spawning a server, streaming a >1 MiB upload, and polling for health all live inside a single test; the hooks
        // that boot and tear down the child need the same headroom.
        testTimeout: 30_000,
        hookTimeout: 40_000,
        reporters: [
            [ 'tree', { summary: false } ],
        ],
    },
});

//----------------------------------------------------------------------------------------------------------------------
