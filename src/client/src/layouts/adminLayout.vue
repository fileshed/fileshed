<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Layout
  --
  -- The admin-area chrome, mirroring the account layout: a sidebar whose section nav *is* the tab strip, the shared
  -- top bar, and the routed tab content. Reaching here at all is role-gated by the router; the server enforces the
  -- real boundary on every call. Same fixed-viewport shell as the other layouts: the frame is pinned to the
  -- viewport and only <main> scrolls.
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
                        Admin
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
        { label: 'Users', icon: 'i-lucide-users', to: '/admin/users' },
        { label: 'Settings', icon: 'i-lucide-sliders-horizontal', to: '/admin/settings' },
        { label: 'Email', icon: 'i-lucide-mail', to: '/admin/email' },
        { label: 'Authentication', icon: 'i-lucide-key-round', to: '/admin/authentication' },
        { label: 'Branding', icon: 'i-lucide-palette', to: '/admin/branding' },
        { label: 'Status', icon: 'i-lucide-activity', to: '/admin/status' },
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
