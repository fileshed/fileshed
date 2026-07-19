//----------------------------------------------------------------------------------------------------------------------
// FileShed Client — Entry Point
//----------------------------------------------------------------------------------------------------------------------

// Styles first, so Tailwind's and Nuxt UI's cascade layers register before any component-injected styles.
import './styles/main.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ui from '@nuxt/ui/vue-plugin';

// App
import App from './app.vue';
import { router } from './router/index.ts';

//----------------------------------------------------------------------------------------------------------------------

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(ui);

app.mount('#app');

//----------------------------------------------------------------------------------------------------------------------
