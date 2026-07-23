<!----------------------------------------------------------------------------------------------------------------------
  -- Account Storage
  --
  -- The account-page storage summary, read from the same session quota the sidebar gauge uses so the two never drift.
  -- Unlike the sidebar's compact label, this always shows the denominator -- "Unlimited" when no quota is set -- so
  -- the possibility of a cap is visible even on uncapped accounts.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div v-if="quota" class="flex flex-col gap-3 rounded-lg border border-default p-4">
        <div class="flex items-center justify-between text-sm">
            <span class="text-muted">Storage</span>
            <span class="text-highlighted">{{ usageLabel }}</span>
        </div>

        <UProgress
            v-if="quota.limit !== null"
            :model-value="quota.used"
            :max="quota.limit"
            size="sm"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { formatBytes } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const quota = computed(() => session.me?.quota ?? null);

    const usageLabel = computed(() =>
    {
        const current = quota.value;
        if(!current) { return ''; }

        const limitLabel = current.limit === null ? 'Unlimited' : formatBytes(current.limit);
        return `${ formatBytes(current.used) } used / ${ limitLabel }`;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
