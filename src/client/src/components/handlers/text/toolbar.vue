<!----------------------------------------------------------------------------------------------------------------------
  -- Editor Toolbar
  --
  -- The control row beside the text editing surface: the markdown/plain mode toggle, the colorscheme picker, and the
  -- gutter toggle. Identity -- the file name, save state, and Save -- lives in the layout header (the text identity
  -- bar), so this row is pure viewing controls that a viewer keeps too, since switching highlighting harms nothing. It
  -- reads the editor store for the mode and the session store for the persisted view preferences.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-wrap items-center justify-end gap-3 border-b border-default px-4 py-2">
        <UFieldGroup>
            <UButton
                :variant="editor.mode === 'markdown' ? 'solid' : 'outline'"
                color="neutral"
                size="sm"
                label="Markdown"
                @click="editor.setMode('markdown')"
            />
            <UButton
                :variant="editor.mode === 'plain' ? 'solid' : 'outline'"
                color="neutral"
                size="sm"
                label="Plain"
                @click="editor.setMode('plain')"
            />
        </UFieldGroup>

        <USelectMenu
            :model-value="selectedThemeID"
            value-key="value"
            :items="editorThemeOptions"
            :search-input="false"
            size="sm"
            color="neutral"
            variant="subtle"
            icon="i-lucide-palette"
            :ui="{ content: 'w-48' }"
            @update:model-value="pickTheme"
        />

        <UButton
            icon="i-lucide-list-ordered"
            color="neutral"
            size="sm"
            :variant="session.editorGutter ? 'solid' : 'outline'"
            :aria-label="session.editorGutter ? 'Hide line numbers' : 'Show line numbers'"
            @click="toggleGutter"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onBeforeUnmount } from 'vue';

    import type { UpdatePreferencesRequest } from '@fileshed/core';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';
    import { useSessionStore } from '../../../stores/session.ts';

    // Components
    import { editorThemeOptions, resolveEditorTheme } from './themeRegistry.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    // The registered name stays descriptive though the file is just the handler namespace's `toolbar`.
    defineOptions({ name: 'EditorToolbar' });

    // The quiet period after the last view-preference change before it is persisted, so arrowing through themes writes
    // once rather than per pick.
    const PREFERENCE_PERSIST_DEBOUNCE_MS = 500;

    const editor = useEditorStore();
    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    //------------------------------------------------------------------------------------------------------------------
    // View preferences
    //------------------------------------------------------------------------------------------------------------------

    // Resolved through the registry so a stale stored id shows the same theme the editor falls back to, not a blank.
    const selectedThemeID = computed(() => resolveEditorTheme(session.editorTheme).id);

    let persistTimer : ReturnType<typeof setTimeout> | null = null;
    let pendingPatch : UpdatePreferencesRequest = {};

    function persistPending() : void
    {
        if(persistTimer !== null) { clearTimeout(persistTimer); }
        persistTimer = null;

        const patch = pendingPatch;
        pendingPatch = {};
        if(Object.keys(patch).length > 0) { void runMutation(() => session.savePreferences(patch)); }
    }

    // Apply a view preference immediately (so the editor swaps live), then persist the settled value after a short
    // quiet period. A burst that touches both keys coalesces into a single write.
    function commitPreference(patch : { editorTheme ?: string; editorGutter ?: boolean }) : void
    {
        session.applyPreferences(patch);

        pendingPatch = { ...pendingPatch, ...patch };
        if(persistTimer !== null) { clearTimeout(persistTimer); }
        persistTimer = setTimeout(persistPending, PREFERENCE_PERSIST_DEBOUNCE_MS);
    }

    function pickTheme(id : string) : void
    {
        if(id === session.editorTheme) { return; }
        commitPreference({ editorTheme: id });
    }

    function toggleGutter() : void
    {
        commitPreference({ editorGutter: !session.editorGutter });
    }

    // Leaving the editor before the quiet period elapses still persists the pending change rather than dropping it.
    onBeforeUnmount(persistPending);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
