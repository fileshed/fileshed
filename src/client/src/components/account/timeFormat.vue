<!----------------------------------------------------------------------------------------------------------------------
  -- Time Format
  --
  -- The account-page control for the clock style of node timestamps. A segmented 12-hour / 24-hour toggle; the active
  -- segment reflects the current preference. Choosing the other option saves it through the same preferences PATCH, so
  -- the drive's dates re-render at once.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <h3 class="font-medium text-default">
            Time format
        </h3>
        <p class="mt-1 text-sm text-muted">
            How timestamps on your files are shown.
        </p>

        <UFieldGroup class="mt-3">
            <UButton
                label="12-hour"
                :variant="session.timeFormat === '12h' ? 'solid' : 'outline'"
                :color="session.timeFormat === '12h' ? 'primary' : 'neutral'"
                :disabled="pending"
                @click="choose('12h')"
            />
            <UButton
                label="24-hour"
                :variant="session.timeFormat === '24h' ? 'solid' : 'outline'"
                :color="session.timeFormat === '24h' ? 'primary' : 'neutral'"
                :disabled="pending"
                @click="choose('24h')"
            />
        </UFieldGroup>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    import type { TimeFormat } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);

    function choose(format : TimeFormat) : void
    {
        if(session.timeFormat === format) { return; }

        void runMutation(() => session.savePreferences({ timeFormat: format }), pending);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
