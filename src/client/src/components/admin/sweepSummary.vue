<!----------------------------------------------------------------------------------------------------------------------
  -- Sweep Summary
  --
  -- The shared chrome around one background sweep's latest run. A sweep the process has not run yet says so rather
  -- than showing a timestamp it does not have; the counts line is the caller's, since each sweep reports its own.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <div class="flex items-center justify-between gap-4">
            <h3 class="font-medium">
                {{ title }}
            </h3>
            <span class="text-sm text-muted">{{ ranAt }}</span>
        </div>
        <p v-if="run" class="mt-1 text-sm text-muted">
            <slot />
        </p>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { formatNodeDate } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        title : string;
        run : { ranAt : string } | null;
    }>();

    const session = useSessionStore();

    const ranAt = computed(() =>
    {
        return props.run === null ? 'Not run yet' : formatNodeDate(props.run.ranAt, session.timeFormat);
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
