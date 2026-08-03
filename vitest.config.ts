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
