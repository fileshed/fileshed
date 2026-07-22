<!----------------------------------------------------------------------------------------------------------------------
  -- Editor Colorscheme
  --
  -- The account-page control for the editor's colorscheme, the second surface over the same preference the editor
  -- toolbar drives. It lists the curated themes from the shared registry and, on a pick, saves it through the session's
  -- preferences path so an open editor adopts it. The current value resolves through the registry, so a stale stored id
  -- shows the theme the editor falls back to rather than a blank. Re-choosing the theme in force never hits the wire.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <h3 class="font-medium text-default">
            Colorscheme
        </h3>
        <p class="mt-1 text-sm text-muted">
            The theme used when editing files.
        </p>

        <USelectMenu
            :model-value="selectedThemeID"
            value-key="value"
            :items="editorThemeOptions"
            :search-input="false"
            icon="i-lucide-palette"
            :disabled="pending"
            class="mt-3 w-64"
            @update:model-value="choose"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Components
    import { editorThemeOptions, resolveEditorTheme } from '../handlers/text/themeRegistry.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);

    const selectedThemeID = computed(() => resolveEditorTheme(session.editorTheme).id);

    function choose(id : string) : void
    {
        if(id === session.editorTheme) { return; }

        void runMutation(() => session.savePreferences({ editorTheme: id }), pending);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
