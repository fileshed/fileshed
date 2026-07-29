<!----------------------------------------------------------------------------------------------------------------------
  -- Quota Meter
  --
  -- The sidebar storage gauge, read from the session profile (/api/me): a used-of-limit label, with a progress bar only
  -- when a limit exists. A null limit is unlimited, so it shows usage alone. Nearing the cap turns the gauge to the
  -- warning color.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UTooltip v-if="quota" :text="hoverLabel" :disabled="hoverLabel === undefined">
        <div class="w-full px-2 text-sm">
            <div class="mb-1 flex items-center justify-between text-muted">
                <span>Storage</span>
                <span :class="nearingCap ? 'font-medium text-error' : ''">{{ usageLabel }}</span>
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
    import { useSessionStore } from '../stores/session.ts';

    // Utils
    import { formatBytes, quotaPercent } from '../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Store
    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const quota = computed(() => session.me?.quota ?? null);

    const nearingCap = computed(() =>
    {
        const current = quota.value;
        if(!current || current.limit === null) { return false; }

        return quotaPercent(current.used, current.limit) >= QUOTA_WARNING_PERCENT;
    });

    const usageLabel = computed(() =>
    {
        const current = quota.value;
        if(!current) { return ''; }

        return current.limit === null
            ? `${ formatBytes(current.used) } used`
            : `${ formatBytes(current.used) } of ${ formatBytes(current.limit) }`;
    });

    // The hover detail: the share of quota consumed, only meaningful when a cap exists.
    const hoverLabel = computed(() =>
    {
        const current = quota.value;
        if(!current || current.limit === null) { return undefined; }

        return `${ Math.round(quotaPercent(current.used, current.limit)) }% of your storage used`;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
