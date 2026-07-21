<!----------------------------------------------------------------------------------------------------------------------
  -- Main Layout
  --
  -- The primary authenticated chrome: sidebar navigation, header with the user menu, and the routed content. Auth
  -- pages render outside this layout (sibling routes), so it can assume a signed-in user.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex min-h-screen bg-default text-default">
        <aside class="flex w-64 shrink-0 flex-col border-r border-default p-4">
            <RouterLink to="/" class="mb-6 px-2 text-xl font-bold">
                {{ app.name }}
            </RouterLink>

            <UNavigationMenu
                orientation="vertical"
                :items="navItems"
                class="flex-1"
            />

            <QuotaMeter class="mt-4" />
        </aside>

        <div class="flex min-w-0 flex-1 flex-col">
            <header class="flex items-center justify-between gap-4 border-b border-default p-4">
                <UInput
                    v-model="searchTerm"
                    icon="i-lucide-search"
                    placeholder="Search files…"
                    class="max-w-md flex-1"
                    @keydown.enter="submitSearch"
                />

                <UDropdownMenu :items="userMenuItems">
                    <UButton variant="ghost" color="neutral" class="gap-2">
                        <UAvatar :alt="displayName" size="sm" />
                        <span class="hidden sm:inline">{{ displayName }}</span>
                    </UButton>
                </UDropdownMenu>
            </header>

            <main class="min-w-0 flex-1 p-6">
                <RouterView />
            </main>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import { RouterLink, RouterView, useRouter } from 'vue-router';
    import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui';

    // Stores
    import { useAppStore } from '../stores/app.ts';
    import { useSessionStore } from '../stores/session.ts';

    // Components
    import QuotaMeter from '../components/quotaMeter.vue';

    //------------------------------------------------------------------------------------------------------------------
    // Stores
    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const session = useSessionStore();
    const router = useRouter();

    //------------------------------------------------------------------------------------------------------------------
    // Navigation
    //------------------------------------------------------------------------------------------------------------------

    const navItems : NavigationMenuItem[] = [
        { label: 'My Drive', icon: 'i-lucide-hard-drive', to: '/', exact: true },
        { label: 'Shared with me', icon: 'i-lucide-users', to: '/shared' },
        { label: 'Trash', icon: 'i-lucide-trash-2', to: '/trash' },
    ];

    //------------------------------------------------------------------------------------------------------------------
    // Search
    //------------------------------------------------------------------------------------------------------------------

    const searchTerm = ref('');

    async function submitSearch() : Promise<void>
    {
        const term = searchTerm.value.trim();
        if(term.length === 0) { return; }

        await router.push({ path: '/search', query: { q: term } });
    }

    //------------------------------------------------------------------------------------------------------------------
    // User menu
    //------------------------------------------------------------------------------------------------------------------

    const displayName = computed(() => session.me?.name ?? session.me?.email ?? 'Account');

    async function signOut() : Promise<void>
    {
        await session.signOut();
        await router.push({ path: '/signin' });
    }

    const userMenuItems = computed<DropdownMenuItem[][]>(() =>
    {
        const groups : DropdownMenuItem[][] = [
            [ { label: session.me?.email ?? '', type: 'label' } ],
            [ { label: 'Account', icon: 'i-lucide-user', to: '/account' } ],
        ];

        if(session.isAdmin)
        {
            groups.push([ { label: 'Admin', icon: 'i-lucide-shield', to: '/admin' } ]);
        }

        groups.push([ { label: 'Sign out', icon: 'i-lucide-log-out', color: 'error', onSelect: signOut } ]);

        return groups;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
