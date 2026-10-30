<!----------------------------------------------------------------------------------------------------------------------
  -- Run Sweep Button
  --
  -- The button stays busy until the sweep finishes, so the toast can carry that run's own counts. A sweep already
  -- running (usually the scheduled one) comes back as the server's refusal. A run the host blocks with `blockedReason`
  -- still toasts the reason instead of disabling the button, so it never looks dead for no stated reason.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UButton
        label="Run now"
        icon="i-lucide-play"
        color="neutral"
        variant="subtle"
        size="sm"
        :loading="running"
        @click="run"
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { SweepKind } from '@fileshed/core';

    // Resource Access
    import { runSweep } from '../../resource-access/admin.ts';

    // Engines
    import { describeSweepRun } from '../../engines/sweepRun.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        sweep : SweepKind;

        // What to call this sweep in the toast, in the host's own words.
        label : string;

        // Why starting the sweep right now would do something the admin did not ask for. Set, the click is refused
        // and this is what they are told.
        blockedReason ?: string;
    }>();

    const emit = defineEmits<{ ran : [] }>();

    const { runMutation } = useRunWithToast();
    const toast = useToast();

    const running = ref(false);

    function run() : void
    {
        if(props.blockedReason !== undefined)
        {
            toast.add({
                title: `${ props.label } not started.`,
                description: props.blockedReason,
                color: 'warning',
            });

            return;
        }

        void runMutation(async () =>
        {
            const outcome = await runSweep(props.sweep);

            toast.add({
                title: `${ props.label } finished.`,
                description: describeSweepRun(outcome),
                color: 'success',
            });
        }, running, () => emit('ran'));
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
