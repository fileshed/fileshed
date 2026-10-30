<!----------------------------------------------------------------------------------------------------------------------
  -- Editor Layout
  --
  -- The center region is a Teleport target (#editor-header-center) that each handler family teleports its name and
  -- actions into, so the header carries the file's identity without the layout knowing which handler is mounted. The
  -- frame is pinned to the viewport, but unlike the other layouts the main region does not scroll; the mounted handler
  -- bounds its own scroller against the height this hands it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-screen flex-col overflow-hidden bg-default text-default">
        <header class="flex items-center gap-4 border-b border-default px-4 py-2">
            <RouterLink to="/" class="flex shrink-0 items-center" :aria-label="`${ app.name } home`">
                <img :src="app.logoUrl" :alt="app.name" class="size-8">
            </RouterLink>

            <div id="editor-header-center" class="flex min-w-0 flex-1 items-center justify-center gap-3" />

            <UserMenu class="shrink-0" />
        </header>

        <main class="min-h-0 min-w-0 flex-1 overflow-hidden">
            <RouterView />
        </main>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { RouterLink, RouterView } from 'vue-router';

    // Stores
    import { useAppStore } from '../stores/app.ts';

    // Components
    import UserMenu from '../components/layout/userMenu.vue';

    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
