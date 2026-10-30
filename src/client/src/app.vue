<!----------------------------------------------------------------------------------------------------------------------
  -- FileShed — Root Component
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UApp>
        <RouterView />
    </UApp>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, watchEffect } from 'vue';
    import { RouterView } from 'vue-router';

    // Stores
    import { useAppStore } from './stores/app.ts';
    import { useSessionStore } from './stores/session.ts';

    // Engines
    import { resolveColorMode } from './engines/colorMode.ts';

    // Utils
    import { applyColorMode } from './utils/colorModeControl.ts';

    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const session = useSessionStore();

    onMounted(() => { void app.initialize(); });

    watchEffect(() =>
    {
        document.title = app.name;
    });

    watchEffect(() =>
    {
        document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', app.logoUrl);
    });

    // Until the handshake answers, the stored localStorage mode from the last visit keeps applying on its own --
    // resolving against null branding here would stomp it with 'system' for no reason.
    watchEffect(() =>
    {
        if(app.branding === null) { return; }

        applyColorMode(resolveColorMode(app.branding, session.colorMode));
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
