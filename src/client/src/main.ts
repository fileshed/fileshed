//----------------------------------------------------------------------------------------------------------------------
// FileShed Client — Entry Point
//----------------------------------------------------------------------------------------------------------------------

// Styles first, so Tailwind's and Nuxt UI's cascade layers register before any component-injected styles.
import './styles/main.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ui from '@nuxt/ui/vue-plugin';
import { useToast } from '@nuxt/ui/composables';

// App
import App from './app.vue';
import { router } from './router/index.ts';

//----------------------------------------------------------------------------------------------------------------------

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ui);

// The backstop for anything nobody caught. The console keeps the real error for whoever is debugging; the toast
// stays generic, because an unhandled error's message is as likely to be a stack frame as something a user can act
// on. useToast() runs through the app context so its inject() has one to read.
function reportUnhandled(error : unknown) : void
{
    console.error('Unhandled client error', error);

    app.runWithContext(() =>
    {
        useToast().add({ title: 'Something went wrong', description: 'Please try again.', color: 'error' });
    });
}

// Vue's handler covers render, lifecycle, and watchers, but a rejected promise escapes it -- Nuxt UI awaits click
// handlers inside an async wrapper of its own, so a throw from any button lands here instead. Both doors, one report.
app.config.errorHandler = reportUnhandled;
window.addEventListener('unhandledrejection', (event) => { reportUnhandled(event.reason); });

app.mount('#app');

//----------------------------------------------------------------------------------------------------------------------
