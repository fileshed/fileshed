<!----------------------------------------------------------------------------------------------------------------------
  -- Account Layout
  --
  -- The account-area chrome: a sidebar whose section nav (Profile, Account, Access tokens, Settings) *is* the tab
  -- strip, over the shared app shell. No drive chrome here -- no New button, no drive nav, no storage gauge -- so the
  -- account tabs stand on their own.
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
            <h1 class="text-2xl font-bold">
                Account
            </h1>

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

    const navItems : NavigationMenuItem[] = [
        { label: 'Profile', icon: 'i-lucide-user', to: '/account/profile' },
        { label: 'Account', icon: 'i-lucide-shield', to: '/account/account' },
        { label: 'Access tokens', icon: 'i-lucide-key-round', to: '/account/tokens' },
        { label: 'Settings', icon: 'i-lucide-settings', to: '/account/settings' },
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
