<!----------------------------------------------------------------------------------------------------------------------
  -- Account Layout
  --
  -- The account-area chrome: a sidebar whose section nav (Profile, Account, Settings) *is* the tab strip, the shared top
  -- bar, and the routed tab content. No drive chrome here -- no New button, no drive nav, no storage gauge -- so the
  -- account tabs stand on their own. Same fixed-viewport shell as the drive layout: the frame is pinned to the viewport
  -- (h-screen) and only <main> scrolls, keeping the sidebar and top bar put on every tab.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-screen overflow-hidden bg-default text-default">
        <aside class="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-default p-4">
            <RouterLink to="/" class="mb-6 flex items-center gap-2 px-2 text-xl font-bold">
                <img src="/fileshed.svg" alt="" class="size-8">
                {{ app.name }}
            </RouterLink>

            <UButton
                to="/"
                icon="i-lucide-arrow-left"
                label="Back to Files"
                color="neutral"
                variant="ghost"
                class="mb-4 justify-start"
            />

            <UNavigationMenu
                orientation="vertical"
                :items="navItems"
                class="flex-1"
            />
        </aside>

        <div class="flex min-w-0 flex-1 flex-col">
            <TopBar />

            <main class="min-h-0 min-w-0 flex-1 overflow-auto p-6">
                <section class="mx-auto flex max-w-4xl flex-col gap-6">
                    <h1 class="text-2xl font-bold">
                        Account
                    </h1>

                    <RouterView />
                </section>
            </main>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { RouterLink, RouterView } from 'vue-router';
    import type { NavigationMenuItem } from '@nuxt/ui';

    // Stores
    import { useAppStore } from '../stores/app.ts';

    // Components
    import TopBar from '../components/layout/topBar.vue';

    //------------------------------------------------------------------------------------------------------------------
    // Stores
    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();

    //------------------------------------------------------------------------------------------------------------------
    // Navigation
    //------------------------------------------------------------------------------------------------------------------

    const navItems : NavigationMenuItem[] = [
        { label: 'Profile', icon: 'i-lucide-user', to: '/account/profile' },
        { label: 'Account', icon: 'i-lucide-shield', to: '/account/account' },
        { label: 'Access tokens', icon: 'i-lucide-key-round', to: '/account/tokens' },
        { label: 'Settings', icon: 'i-lucide-settings', to: '/account/settings' },
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
