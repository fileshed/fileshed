<!----------------------------------------------------------------------------------------------------------------------
  -- Color Mode Preference
  --
  -- The account-page control for light/dark/system. Saving persists the choice in the preferences blob (it roams
  -- across devices) and the root component applies it at once. When the instance forces a mode, the control says
  -- so instead of offering a choice that would not apply.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <h3 class="font-medium text-default">
            Appearance
        </h3>
        <p class="mt-1 text-sm text-muted">
            Light, dark, or follow your device.
        </p>

        <p v-if="app.forcedMode" class="mt-3 text-sm text-muted">
            The administrator has set the appearance for this instance.
        </p>

        <UFieldGroup v-else class="mt-3">
            <UButton
                v-for="option of OPTIONS"
                :key="option.value"
                :label="option.label"
                :variant="active === option.value ? 'solid' : 'outline'"
                :color="active === option.value ? 'primary' : 'neutral'"
                :disabled="pending"
                @click="choose(option.value)"
            />
        </UFieldGroup>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    import type { ColorMode } from '@fileshed/core';

    // Stores
    import { useAppStore } from '../../stores/app.ts';
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const OPTIONS : { label : string; value : ColorMode }[] = [
        { label: 'System', value: 'system' },
        { label: 'Light', value: 'light' },
        { label: 'Dark', value: 'dark' },
    ];

    const app = useAppStore();
    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);

    const active = computed(() => session.colorMode ?? 'system');

    function choose(mode : ColorMode) : void
    {
        if(active.value === mode) { return; }

        session.applyPreferences({ colorMode: mode });
        void runMutation(() => session.savePreferences({ colorMode: mode }), pending);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
