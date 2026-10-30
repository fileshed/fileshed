<!----------------------------------------------------------------------------------------------------------------------
  -- App Shell
  --
  -- The frame is pinned to the viewport and only <main> scrolls, so the sidebar and top bar stay put and a route that
  -- fills the height has a real height to bound its own scroller against. The #sidebar slot renders in two places, the
  -- fixed rail from md up and a slideover below it, so an area describes its navigation once.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-screen overflow-hidden bg-default text-default">
        <aside class="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-default p-4 md:flex">
            <slot name="sidebar" />
        </aside>

        <USlideover
            v-model:open="drawerOpen"
            side="left"
            :title="`${ app.name } navigation`"
            :ui="{ content: 'max-w-64' }"
        >
            <template #content>
                <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                    <slot name="sidebar" />
                </div>
            </template>
        </USlideover>

        <div class="flex min-w-0 flex-1 flex-col">
            <TopBar>
                <template #leading>
                    <UButton
                        icon="i-lucide-menu"
                        color="neutral"
                        variant="ghost"
                        aria-label="Open navigation"
                        class="shrink-0 md:hidden"
                        @click="drawerOpen = true"
                    />
                </template>
            </TopBar>

            <main class="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6">
                <slot />
            </main>
        </div>

        <slot name="overlays" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref, watch } from 'vue';
    import { useRoute } from 'vue-router';

    // Stores
    import { useAppStore } from '../../stores/app.ts';

    // Components
    import TopBar from './topBar.vue';

    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const route = useRoute();

    const drawerOpen = ref(false);

    watch(() => route.fullPath, () => { drawerOpen.value = false; });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
