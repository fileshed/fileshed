<!----------------------------------------------------------------------------------------------------------------------
  -- Quota Meter
  --
  -- The sidebar storage gauge, read from the session profile (/api/me): a used-of-limit label, with a progress bar only
  -- when a limit exists. A null limit is unlimited, so it shows usage alone.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div v-if="quota" class="px-2 text-sm">
        <div class="mb-1 flex items-center justify-between text-muted">
            <span>Storage</span>
            <span>{{ usageLabel }}</span>
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
    import { useSessionStore } from '../stores/session.ts';

    // Utils
    import { formatBytes } from '../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Store
    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const quota = computed(() => session.me?.quota ?? null);

    const usageLabel = computed(() =>
    {
        const current = quota.value;
        if(!current) { return ''; }

        return current.limit === null
            ? `${ formatBytes(current.used) } used`
            : `${ formatBytes(current.used) } of ${ formatBytes(current.limit) }`;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
