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
                        secondary: 'violet',
                        neutral: 'zinc',
                    },
                    // Stock neutral-ghost hovers with bg-elevated -- invisible on this app's chrome, which mostly
                    // sits ON elevated panels (dark mode's elevated and muted tokens collide). Hover one step up
                    // the ladder instead, matching what neutral soft/subtle already do.
                    button: {
                        compoundVariants: [
                            {
                                color: 'neutral',
                                variant: 'ghost',
                                class: 'hover:bg-accented/75 active:bg-accented/75',
                            },
                        ],
                    },
                },
                // Handler families deliberately reuse basenames (each family owns an identityBar.vue, toolbar.vue,
                // ...) and every use is an explicit import. Excluding them from component auto-registration kills
                // the basename-conflict warnings and the wrong-family <Toolbar /> resolution footgun.
                components: {
                    globsExclude: [ 'src/components/handlers/**' ],
                },
            }),
            devServer({
                entry: '../server/server.ts',
                exclude: [
                    /^(?!\/api\/|\/d\/).*/,
                ],
            }),
        ],
    };
});

//----------------------------------------------------------------------------------------------------------------------
