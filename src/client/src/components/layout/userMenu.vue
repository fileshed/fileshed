<!----------------------------------------------------------------------------------------------------------------------
  -- User Menu
  --
  -- The signed-in user's avatar dropdown: identity label, a link to the account area, the admin entry for admins, and
  -- sign-out. It owns its own sign-out and post-sign-out redirect, so any shell -- the drive top bar, the editor
  -- header -- mounts it without wiring anything through.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UDropdownMenu :items="userMenuItems">
        <UButton variant="ghost" color="neutral" class="gap-2">
            <UAvatar :src="avatarUrl" :alt="displayName" size="sm" />
            <span class="hidden sm:inline">{{ displayName }}</span>
        </UButton>
    </UDropdownMenu>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import { useRouter } from 'vue-router';
    import type { DropdownMenuItem } from '@nuxt/ui';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const router = useRouter();

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
