<!----------------------------------------------------------------------------------------------------------------------
  -- Account Storage
  --
  -- The account-page storage summary, read from the same session quota the sidebar gauge uses so the two never drift.
  -- Unlike the sidebar's compact label, this always shows the denominator -- "Unlimited" when nothing caps the account
  -- -- so the possibility of a cap is visible even on uncapped accounts. The denominator is the effective cap, with
  -- the instance default already folded in, never the account's own raw setting.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UTooltip v-if="quota" :text="hoverLabel" :disabled="hoverLabel === undefined">
        <div class="flex w-full flex-col gap-3 rounded-lg border border-default p-4">
            <div class="flex items-center justify-between text-sm">
                <span class="text-muted">Storage</span>
                <span :class="nearingCap ? 'font-medium text-error' : 'text-highlighted'">{{ usageLabel }}</span>
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
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { formatBytes, nearingQuotaCap, quotaHoverLabel } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const quota = computed(() => session.me?.quota ?? null);

    const nearingCap = computed(() => nearingQuotaCap(quota.value));
    const hoverLabel = computed(() => quotaHoverLabel(quota.value));

    const usageLabel = computed(() =>
    {
        const current = quota.value;
        if(!current) { return ''; }

        const limitLabel = current.effective === null ? 'Unlimited' : formatBytes(current.effective);
        return `${ formatBytes(current.used) } used / ${ limitLabel }`;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
