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

    import type { ColorMode } from '@fileshed/core';

    // Stores
    import { useAppStore } from '../../stores/app.ts';
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const THEME_OPTIONS : { label : string; value : ColorMode; icon : string }[] = [
        { label: 'System', value: 'system', icon: 'i-lucide-monitor' },
        { label: 'Light', value: 'light', icon: 'i-lucide-sun' },
        { label: 'Dark', value: 'dark', icon: 'i-lucide-moon' },
    ];

    const app = useAppStore();
    const session = useSessionStore();
    const router = useRouter();
    const { runMutation } = useRunWithToast();

    const displayName = computed(() => session.me?.name ?? session.me?.email ?? 'Account');
    const avatarUrl = computed(() => session.me?.image ?? undefined);

    async function signOut() : Promise<void>
    {
        await session.signOut();
        await router.push({ path: '/signin' });
    }

    function chooseTheme(mode : ColorMode) : void
    {
        session.applyPreferences({ colorMode: mode });
        void runMutation(() => session.savePreferences({ colorMode: mode }));
    }

    const userMenuItems = computed<DropdownMenuItem[][]>(() =>
    {
        const groups : DropdownMenuItem[][] = [ [ { label: session.me?.email ?? '', type: 'label' } ] ];

        if(!app.forcedMode)
        {
            const active = session.colorMode ?? 'system';
            groups.push([ {
                label: 'Theme',
                icon: 'i-lucide-sun-moon',
                children: THEME_OPTIONS.map((option) => ({
                    label: option.label,
                    icon: option.icon,
                    type: 'checkbox' as const,
                    checked: active === option.value,
                    onSelect: () => chooseTheme(option.value),
                })),
            } ]);
        }

        groups.push([ { label: 'Account', icon: 'i-lucide-user', to: '/account' } ]);

        if(session.isAdmin)
        {
            groups.push([ { label: 'Admin', icon: 'i-lucide-shield', to: '/admin' } ]);
        }

        groups.push([ { label: 'Sign out', icon: 'i-lucide-log-out', color: 'error', onSelect: signOut } ]);

        return groups;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
