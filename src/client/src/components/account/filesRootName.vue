<!----------------------------------------------------------------------------------------------------------------------
  -- Files Root Name
  --
  -- The account-page control that names the files root. The field prefills with the current name (blank when none is
  -- set, the default showing as placeholder); Save is live only when the draft differs from what is stored. An empty
  -- draft clears the preference, resetting the root to its default. Saving updates the session profile, so the sidebar
  -- and breadcrumb re-label at once.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <h3 class="font-medium text-default">
            Files root name
        </h3>
        <p class="mt-1 text-sm text-muted">
            The name shown for your top-level files. Leave blank to use the default ({{ DEFAULT_ROOT_LABEL }}).
        </p>

        <div class="mt-3 flex items-start gap-2">
            <UInput
                v-model="draft"
                :placeholder="DEFAULT_ROOT_LABEL"
                :maxlength="ROOT_LABEL_MAX_LENGTH"
                class="flex-1"
                @keydown.enter="save"
            />
            <UButton label="Save" :loading="pending" :disabled="!dirty" @click="save" />
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    import { DEFAULT_ROOT_LABEL, ROOT_LABEL_MAX_LENGTH } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);

    // The stored name, or empty when none is set -- the draft's baseline and the dirty comparison.
    const storedLabel = computed(() => session.me?.preferences.rootLabel ?? '');
    const draft = ref(storedLabel.value);

    const dirty = computed(() => draft.value.trim() !== storedLabel.value);

    function save() : void
    {
        const trimmed = draft.value.trim();
        const patch = trimmed === '' ? { rootLabel: null } : { rootLabel: trimmed };

        void runMutation(() => session.savePreferences(patch), pending, () =>
        {
            // Adopt the stored value the server settled on (its own trim), so the field matches what was saved.
            draft.value = storedLabel.value;
        });
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
