<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Layout
  --
  -- The admin-area chrome, mirroring the account layout: a sidebar whose section nav *is* the tab strip, over the
  -- shared app shell. Reaching here at all is role-gated by the router; the server enforces the real boundary on
  -- every call.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <AppShell>
        <template #sidebar>
            <RouterLink to="/" class="mb-6 flex items-center gap-2 px-2 text-xl font-bold">
                <img :src="app.logoUrl" alt="" class="size-8">
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
        </template>

        <section class="mx-auto flex max-w-4xl flex-col gap-6">
            <div class="flex items-center justify-between gap-4">
                <h1 class="text-2xl font-bold">
                    Admin
                </h1>
                <div id="admin-header-actions" class="flex items-center gap-2" />
            </div>

            <RouterView />
        </section>
    </AppShell>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { RouterLink, RouterView } from 'vue-router';
    import type { NavigationMenuItem } from '@nuxt/ui';

    // Stores
    import { useAppStore } from '../stores/app.ts';

    // Components
    import AppShell from '../components/layout/appShell.vue';

    //------------------------------------------------------------------------------------------------------------------
    // Stores
    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();

    //------------------------------------------------------------------------------------------------------------------
    // Navigation
    //------------------------------------------------------------------------------------------------------------------

    // Lifecycle order, not alphabetical: the read-only glance an admin lands on first, then the pages they revisit
    // (people and how they get in), then set-and-forget configuration.
    const navItems : NavigationMenuItem[] = [
        { label: 'Overview', icon: 'i-lucide-layout-dashboard', to: '/admin/overview' },
        { label: 'Users', icon: 'i-lucide-users', to: '/admin/users' },
        { label: 'Authentication', icon: 'i-lucide-key-round', to: '/admin/authentication' },
        { label: 'Settings', icon: 'i-lucide-sliders-horizontal', to: '/admin/settings' },
        { label: 'Email', icon: 'i-lucide-mail', to: '/admin/email' },
        { label: 'Branding', icon: 'i-lucide-palette', to: '/admin/branding' },
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
