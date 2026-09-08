//----------------------------------------------------------------------------------------------------------------------
// Vitest Configuration
//----------------------------------------------------------------------------------------------------------------------

import path from 'node:path';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

//----------------------------------------------------------------------------------------------------------------------

export default defineConfig({
    resolve: {
        alias: {
            '@server': path.resolve(__dirname, 'src/server'),
            '@client': path.resolve(__dirname, 'src/client/src'),
            '@fileshed/core': path.resolve(__dirname, 'packages/core/src'),

            // The client's Vite root is src/client, so template logos resolve /fileshed.svg against its public dir.
            // Tests run from the repo root, so point that one public asset at the real file to render layout chrome.
            '/fileshed.svg': path.resolve(__dirname, 'src/client/public/fileshed.svg'),
        },
    },
    test: {
        globals: true,
        passWithNoTests: true,
        coverage: {
            provider: 'v8',
            reporter: [ 'text', 'lcov' ],
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'server',
                    include: [ 'tests/server/**/*.spec.ts' ],
                    setupFiles: [ './tests/server/support/setup.ts' ],
                    globalSetup: [ './tests/server/support/globalSetup.ts' ],

                    // Vitest's 5s default is a budget for a pure function. The unit of work here is a real database:
                    // on Postgres a single boot creates a database and migrates it, measured at 116ms idle and 1.3s
                    // with every core saturated -- and CI runs on two cores, where that multiplier is larger still.
                    // A run at 5s was spending a quarter of its budget before a test's first assertion.
                    //
                    // Raised rather than worked around because there is nothing here to hide: a run holds 16 of the
                    // server's 100 connections at its peak, and every database it provisions is reclaimed after the
                    // test that asked for it. What was failing was the clock, not a leak.
                    testTimeout: 20_000,
                    hookTimeout: 20_000,
                },
            },
            {
                extends: true,
                plugins: [ vue() ],
                test: {
                    name: 'client',
                    include: [ 'tests/client/**/*.spec.ts' ],
                    environment: 'jsdom',
                },
            },
            {
                extends: true,
                test: {
                    name: 'core',
                    include: [ 'tests/core/**/*.spec.ts' ],
                },
            },
        ],
    },
});

//----------------------------------------------------------------------------------------------------------------------
