<!----------------------------------------------------------------------------------------------------------------------
  -- Admin User Row
  --
  -- One account in the admin table: identity, role and ban badges, charged usage, quota, joined date, and the
  -- actions menu. The row decides nothing -- every action is emitted for the tab to run -- but it does gray out the
  -- self-directed footguns (self-ban, self-demotion) the server would refuse anyway.
  --
  -- The quota shown is what the server says is actually enforced: an account with no limit of its own is capped by
  -- the instance default, and says so, rather than claiming to be unlimited.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <tr class="border-b border-default last:border-b-0">
        <td class="px-4 py-3">
            <div class="truncate font-medium">
                {{ user.name ?? '—' }}
            </div>
            <div class="truncate text-muted">
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
        <td class="hidden px-4 py-3 text-muted lg:table-cell">
            {{ formatBytes(user.usedBytes) }}
            <span v-if="usagePercent !== null" :class="nearingCap ? 'font-medium text-error' : ''">
                ({{ usagePercent }}%)
            </span>
        </td>
        <td class="hidden px-4 py-3 text-muted lg:table-cell">
            {{ quotaLabel }}
            <span v-if="user.quotaLimit === null" class="text-dimmed">(default)</span>
        </td>
        <td class="hidden px-4 py-3 text-muted xl:table-cell">
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

    import type { AdminUserResponse } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { formatBytes, formatNodeDate, nearingQuotaCap, quotaPercent } from '../../utils/formatters/index.ts';

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

    const quotaLabel = computed(() =>
    {
        const cap = props.user.quotaEffective;

        return cap === null ? 'Unlimited' : formatBytes(cap);
    });

    // The rounded share of quota consumed, shown only for capped accounts. The warning color comes from the shared
    // gauge rule on the unrounded value, so this row and the user's own meter agree at the boundary.
    const usagePercent = computed(() =>
    {
        const cap = props.user.quotaEffective;
        if(cap === null) { return null; }

        return Math.round(quotaPercent(props.user.usedBytes, cap));
    });

    const nearingCap = computed(
        () => nearingQuotaCap({ used: props.user.usedBytes, effective: props.user.quotaEffective })
    );

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
