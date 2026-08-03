//----------------------------------------------------------------------------------------------------------------------
// Vite Configuration
//----------------------------------------------------------------------------------------------------------------------

import { defineConfig } from 'vite';
import vueDevtools from 'vite-plugin-vue-devtools';
import checker from 'vite-plugin-checker';
import vue from '@vitejs/plugin-vue';
import ui from '@nuxt/ui/vite';
import devServer from '@hono/vite-dev-server';

// Models
import { STOCK_THEME, socialProviderIDs } from '@fileshed/core';

// Utils
import { loadViteEnv } from './env.ts';
import { providerIcon } from './src/utils/formatters/providerPresentation.ts';

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
                // Icons resolve from the build-time client bundle; anything missing falls back to a runtime fetch
                // against api.iconify.design, which multi-dash collection names (i-simple-icons-*) cannot survive
                // -- the resolver splits at the first dash and looks up a collection that does not exist. Scanning
                // bundles every icon named literally in the source; the provider brand icons are built from
                // dynamic ids a scan cannot see, so they are listed outright. Bundling everything also keeps a
                // self-hosted deployment from leaking icon lookups to a third-party CDN.
                icon: {
                    clientBundle: {
                        scan: true,
                        icons: socialProviderIDs.map((provider) => providerIcon(provider)),
                    },
                },
                ui: {
                    colors: {
                        primary: STOCK_THEME.primary,
                        secondary: STOCK_THEME.secondary,
                        neutral: STOCK_THEME.neutral,
                    },
                    // Stock neutral-ghost hovers with bg-elevated -- invisible on this app's chrome, which mostly
                    // sits ON elevated panels (dark mode's elevated and muted tokens collide). Hover one step up
                    // the ladder instead, matching what neutral soft/subtle already do.
                    //
                    // A disabled solid button keeps its fill in stock Nuxt UI (`disabled:bg-{color}` pins the
                    // color past hover, and the base slot only fades it to 75%), so a Save with nothing to save
                    // still reads as the page's call to action. Drop the fill to the grey ladder instead --
                    // accented rather than elevated so the button stays visible on the elevated chrome the
                    // editor bars sit on.
                    button: {
                        compoundVariants: [
                            {
                                color: 'neutral',
                                variant: 'ghost',
                                class: 'hover:bg-accented/75 active:bg-accented/75',
                            },
                            {
                                variant: 'solid',
                                class: 'disabled:bg-accented disabled:text-muted aria-disabled:bg-accented '
                                    + 'aria-disabled:text-muted',
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
        server: {
            // Poll instead of trusting macOS FSEvents: the kernel stream drops events under filesystem storms
            // (full test runs alongside the dev server), leaving HMR serving stale modules until a restart. Polling
            // has no event channel to lose; at this tree's size the interval costs nothing noticeable.
            watch: {
                usePolling: true,
                interval: 300,
            },
        },
    };
});

//----------------------------------------------------------------------------------------------------------------------
