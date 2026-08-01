<!----------------------------------------------------------------------------------------------------------------------
  -- Quota Meter
  --
  -- The sidebar storage gauge, read from the session profile (/api/me): a used-of-limit label, with a progress bar only
  -- when a limit exists. The cap shown is the effective one -- the instance default already folded in -- because an
  -- account with no limit of its own is still capped by whatever the instance defaults to. Nearing the cap turns the
  -- gauge to the warning color.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UTooltip v-if="quota" :text="hoverLabel" :disabled="hoverLabel === undefined">
        <div class="w-full px-2 text-sm">
            <div class="mb-1 flex items-center justify-between text-muted">
                <span>Storage</span>
                <span :class="nearingCap ? 'font-medium text-error' : ''">{{ usageLabel }}</span>
            </div>

            <UProgress
                v-if="quota.effective !== null"
                :model-value="quota.used"
                :max="quota.effective"
                :color="nearingCap ? 'error' : 'primary'"
                size="sm"
            />
        </div>
    </UTooltip>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { useSessionStore } from '../stores/session.ts';

    // Utils
    import { formatBytes, nearingQuotaCap, quotaHoverLabel } from '../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Store
    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const quota = computed(() => session.me?.quota ?? null);

    const nearingCap = computed(() => nearingQuotaCap(quota.value));
    const hoverLabel = computed(() => quotaHoverLabel(quota.value));

    const usageLabel = computed(() =>
    {
        const current = quota.value;
        if(!current) { return ''; }

        return current.effective === null
            ? `${ formatBytes(current.used) } used`
            : `${ formatBytes(current.used) } of ${ formatBytes(current.effective) }`;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
