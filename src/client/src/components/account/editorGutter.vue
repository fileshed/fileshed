<!----------------------------------------------------------------------------------------------------------------------
  -- Editor Gutter
  --
  -- The account-page toggle for the editor's line-number gutter, the second surface over the same preference the editor
  -- toolbar drives. Flipping it saves through the session's preferences path so an open editor shows or hides its gutter
  -- at once. The switch reflects the stored preference, defaulting off until the user turns it on.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex items-center justify-between gap-4 rounded-lg border border-default p-4">
        <div class="min-w-0">
            <h3 class="font-medium text-default">
                Line numbers
            </h3>
            <p class="mt-1 text-sm text-muted">
                Show a line-number gutter while editing files.
            </p>
        </div>

        <USwitch
            :model-value="session.editorGutter"
            :disabled="pending"
            @update:model-value="choose"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);

    function choose(enabled : boolean) : void
    {
        void runMutation(() => session.savePreferences({ editorGutter: enabled }), pending);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
