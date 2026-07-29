<!----------------------------------------------------------------------------------------------------------------------
  -- Account Storage
  --
  -- The account-page storage summary, read from the same session quota the sidebar gauge uses so the two never drift.
  -- Unlike the sidebar's compact label, this always shows the denominator -- "Unlimited" when no quota is set -- so
  -- the possibility of a cap is visible even on uncapped accounts.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UTooltip v-if="quota" :text="hoverLabel" :disabled="hoverLabel === undefined">
        <div class="flex w-full flex-col gap-3 rounded-lg border border-default p-4">
            <div class="flex items-center justify-between text-sm">
                <span class="text-muted">Storage</span>
                <span :class="nearingCap ? 'font-medium text-error' : 'text-highlighted'">{{ usageLabel }}</span>
            </div>

            <UProgress
                v-if="quota.limit !== null"
                :model-value="quota.used"
                :max="quota.limit"
                :color="nearingCap ? 'error' : 'primary'"
                size="sm"
            />
        </div>
    </UTooltip>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import { QUOTA_WARNING_PERCENT } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { formatBytes, quotaPercent } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const quota = computed(() => session.me?.quota ?? null);

    const nearingCap = computed(() =>
    {
        const current = quota.value;
        if(!current || current.limit === null) { return false; }

        return quotaPercent(current.used, current.limit) >= QUOTA_WARNING_PERCENT;
    });

    // The hover detail: the share of quota consumed, only meaningful when a cap exists.
    const hoverLabel = computed(() =>
    {
        const current = quota.value;
        if(!current || current.limit === null) { return undefined; }

        return `${ Math.round(quotaPercent(current.used, current.limit)) }% of your storage used`;
    });

    const usageLabel = computed(() =>
    {
        const current = quota.value;
        if(!current) { return ''; }

        const limitLabel = current.limit === null ? 'Unlimited' : formatBytes(current.limit);
        return `${ formatBytes(current.used) } used / ${ limitLabel }`;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
