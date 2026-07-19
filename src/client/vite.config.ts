//----------------------------------------------------------------------------------------------------------------------
// Vite Configuration
//----------------------------------------------------------------------------------------------------------------------

import { defineConfig, loadEnv } from 'vite';
import vueDevtools from 'vite-plugin-vue-devtools';
import checker from 'vite-plugin-checker';
import vue from '@vitejs/plugin-vue';
import ui from '@nuxt/ui/vite';
import devServer from '@hono/vite-dev-server';

//----------------------------------------------------------------------------------------------------------------------

export default defineConfig(({ mode }) =>
{
    const env = loadEnv(mode, '../..', '');

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
            ui(),
            devServer({
                entry: '../server/app.ts',
                exclude: [
                    /^(?!\/api\/).*/,
                ],
            }),
        ],
    };
});

//----------------------------------------------------------------------------------------------------------------------
