//----------------------------------------------------------------------------------------------------------------------
// Vite Configuration
//----------------------------------------------------------------------------------------------------------------------

import { defineConfig } from 'vite';
import vueDevtools from 'vite-plugin-vue-devtools';
import checker from 'vite-plugin-checker';
import vue from '@vitejs/plugin-vue';
import ui from '@nuxt/ui/vite';
import devServer from '@hono/vite-dev-server';

// Utils
import { loadViteEnv } from './env.ts';

//----------------------------------------------------------------------------------------------------------------------

export default defineConfig(({ mode }) =>
{
    const env = loadViteEnv(mode, '../..');

    return {
        envDir: '../..',
        plugins: [
            vueDevtools({ launchEditor: env.LAUNCH_EDITOR || 'webstorm' }),
            checker({
                eslint: {
                    lintCommand: 'eslint "src/**/*.{ts,js,vue}" --max-warnings=0',
                    useFlatConfig: true,
                },
                vueTsc: {
                    tsconfigPath: 'tsconfig.json',
                },
            }),
            vue(),
            ui({
                ui: {
                    colors: {
                        primary: 'shed',
                        neutral: 'zinc',
                    },
                },
            }),
            devServer({
                entry: '../server/server.ts',
                exclude: [
                    /^(?!\/api\/).*/,
                ],
            }),
        ],
    };
});

//----------------------------------------------------------------------------------------------------------------------
