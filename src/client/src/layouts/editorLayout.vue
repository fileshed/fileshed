<!----------------------------------------------------------------------------------------------------------------------
  -- Editor Layout
  --
  -- The file surface's own chrome: a single slim header -- the FileShed mark linking home, a center region the mounted
  -- handler contributes its identity into, and the user menu -- over a full-viewport region that the handler owns. No
  -- drive chrome (no sidebar, no New button, no drive nav, no storage gauge, no search): the surface's whole job is one
  -- file, so it gets the whole screen, and the logo is the only way back out of the tab. The center is a Teleport
  -- target (#editor-header-center): each family teleports its name + action cluster in, so the header carries the file's
  -- identity without the layout knowing which handler is mounted. Same fixed-viewport shell as the other layouts -- the
  -- frame is pinned to the viewport (h-screen) and the header stays put -- but here the main region does not scroll; the
  -- mounted handler bounds its own scroller against the height this hands it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-screen flex-col overflow-hidden bg-default text-default">
        <header class="flex items-center gap-4 border-b border-default px-4 py-2">
            <RouterLink to="/" class="flex shrink-0 items-center" aria-label="FileShed home">
                <img src="/fileshed.svg" alt="FileShed" class="size-8">
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

    // Components
    import UserMenu from '../components/layout/userMenu.vue';
</script>

<!--------------------------------------------------------------------------------------------------------------------->
