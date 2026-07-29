<!----------------------------------------------------------------------------------------------------------------------
  -- Admin User Row
  --
  -- One account in the admin table: identity, role and ban badges, charged usage, quota, joined date, and the
  -- actions menu. The row decides nothing -- every action is emitted for the tab to run -- but it does gray out the
  -- self-directed footguns (self-ban, self-demotion) the server would refuse anyway.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <tr class="border-b border-default last:border-b-0">
        <td class="px-4 py-3">
            <div class="font-medium">
                {{ user.name ?? '—' }}
            </div>
            <div class="text-muted">
                {{ user.email }}
            </div>
        </td>
        <td class="px-4 py-3">
            <div class="flex flex-wrap gap-1">
                <UBadge
                    :label="user.role"
                    :color="user.role === 'admin' ? 'primary' : 'neutral'"
                    variant="subtle"
                    size="sm"
                />
                <UBadge
                    v-if="user.banned"
                    :label="banLabel"
                    color="error"
                    variant="subtle"
                    size="sm"
                    :title="user.banReason ?? undefined"
                />
            </div>
        </td>
        <td class="px-4 py-3 text-muted">
            {{ formatBytes(user.usedBytes) }}
            <span v-if="usagePercent !== null" :class="nearingCap ? 'font-medium text-error' : ''">
                ({{ usagePercent }}%)
            </span>
        </td>
        <td class="px-4 py-3 text-muted">
            {{ user.quotaLimit === null ? 'Unlimited' : formatBytes(user.quotaLimit) }}
        </td>
        <td class="px-4 py-3 text-muted">
            {{ formatNodeDate(user.createdAt, session.timeFormat) }}
        </td>
        <td class="px-2 py-3 text-right">
            <UDropdownMenu :items="menuItems">
                <UButton
                    icon="i-lucide-ellipsis-vertical"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    aria-label="User actions"
                />
            </UDropdownMenu>
        </td>
    </tr>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    import { type AdminUserResponse, QUOTA_WARNING_PERCENT } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { formatBytes, formatNodeDate, quotaPercent } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{ user : AdminUserResponse }>();

    const emit = defineEmits<{
        quota : [];
        password : [];
        ban : [];
        unban : [];
        promote : [];
        demote : [];
        revokeSessions : [];
    }>();

    const session = useSessionStore();

    const isSelf = computed(() => session.me?.id === props.user.id);

    // The share of quota consumed, shown only for capped accounts and warning-colored from the same threshold the
    // user's own gauge uses.
    const usagePercent = computed(() =>
    {
        if(props.user.quotaLimit === null) { return null; }

        return Math.round(quotaPercent(props.user.usedBytes, props.user.quotaLimit));
    });

    const nearingCap = computed(() => usagePercent.value !== null && usagePercent.value >= QUOTA_WARNING_PERCENT);

    const banLabel = computed(() =>
    {
        if(props.user.banExpires === null) { return 'Banned'; }

        return `Banned until ${ new Date(props.user.banExpires).toLocaleDateString() }`;
    });

    const menuItems = computed<DropdownMenuItem[][]>(() =>
    {
        const manage : DropdownMenuItem[] = [
            { label: 'Set quota…', icon: 'i-lucide-gauge', onSelect: () => emit('quota') },
            { label: 'Set password…', icon: 'i-lucide-key-round', onSelect: () => emit('password') },
            props.user.role === 'admin'
                ? {
                    label: 'Demote to user',
                    icon: 'i-lucide-arrow-down',
                    disabled: isSelf.value,
                    onSelect: () => emit('demote'),
                }
                : { label: 'Promote to admin', icon: 'i-lucide-arrow-up', onSelect: () => emit('promote') },
        ];

        const danger : DropdownMenuItem[] = [
            { label: 'Sign out everywhere', icon: 'i-lucide-log-out', onSelect: () => emit('revokeSessions') },
            props.user.banned
                ? { label: 'Unban', icon: 'i-lucide-shield-check', onSelect: () => emit('unban') }
                : {
                    label: 'Ban…',
                    icon: 'i-lucide-shield-ban',
                    color: 'error',
                    disabled: isSelf.value,
                    onSelect: () => emit('ban'),
                },
        ];

        return [ manage, danger ];
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
