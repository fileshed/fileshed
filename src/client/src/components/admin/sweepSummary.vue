<!----------------------------------------------------------------------------------------------------------------------
  -- Sweep Summary
  --
  -- The shared chrome around one background sweep's latest run, and the button that runs it now. A sweep the process
  -- has not run yet says so rather than showing a timestamp it does not have; the counts line is the caller's, since
  -- each sweep reports its own.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h3 class="font-medium">
                {{ title }}
            </h3>
            <div class="flex items-center gap-3">
                <span class="text-sm text-muted">{{ ranAt }}</span>
                <RunSweepButton :sweep="sweep" :label="title" @ran="emit('ran')" />
            </div>
        </div>
        <p v-if="run" class="mt-1 text-sm text-muted">
            <slot />
        </p>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { SweepKind } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Components
    import RunSweepButton from './runSweepButton.vue';

    // Utils
    import { formatNodeDate } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        title : string;
        sweep : SweepKind;
        run : { ranAt : string } | null;
    }>();

    const emit = defineEmits<{ ran : [] }>();

    const session = useSessionStore();

    const ranAt = computed(() =>
    {
        return props.run === null ? 'Not run yet' : formatNodeDate(props.run.ranAt, session.timeFormat);
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
