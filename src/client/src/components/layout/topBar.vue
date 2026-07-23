<!----------------------------------------------------------------------------------------------------------------------
  -- Top Bar
  --
  -- The header shared by the authenticated layouts: the file search box and the user menu. It owns its own search
  -- submission and sign-out, so both the drive shell and the account shell mount it without wiring anything through.
  --------------------------------------------------------------------------------------------------------------------->

<template>
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
                <UAvatar :src="avatarUrl" :alt="displayName" size="sm" />
                <span class="hidden sm:inline">{{ displayName }}</span>
            </UButton>
        </UDropdownMenu>
    </header>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import { useRouter } from 'vue-router';
    import type { DropdownMenuItem } from '@nuxt/ui';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Stores
    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const router = useRouter();

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
    const avatarUrl = computed(() => session.me?.image ?? undefined);

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
