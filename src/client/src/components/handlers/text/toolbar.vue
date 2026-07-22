<!----------------------------------------------------------------------------------------------------------------------
  -- Editor Toolbar
  --
  -- The chrome above the editing surface: back to the folder, the file name, the markdown/plain mode toggle, the
  -- colorscheme picker and gutter toggle, a save state indicator (dirty, saving, saved, or a save error), and the Save
  -- button. A read-only session (a viewer) shows a Read only badge in place of the save controls but keeps the view
  -- controls, since switching highlighting harms nothing. It reads and drives the editor store for the file session and
  -- the session store for the persisted view preferences; only navigation, which belongs to the page, is emitted.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-wrap items-center gap-3 border-b border-default px-4 py-2">
        <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            label="Back"
            @click="emit('back')"
        />

        <div class="flex min-w-0 items-center gap-2">
            <UIcon name="i-lucide-file-pen" class="shrink-0 text-dimmed" />
            <span class="truncate font-medium">{{ editor.node?.name ?? 'Untitled' }}</span>
        </div>

        <div class="ml-auto flex items-center gap-3">
            <span v-if="status" :class="[ 'text-sm', statusTone ]">{{ status }}</span>

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

            <UBadge v-if="editor.readOnly" color="neutral" variant="subtle" label="Read only" icon="i-lucide-eye" />
            <UButton
                v-else
                icon="i-lucide-save"
                label="Save"
                :loading="editor.saving"
                :disabled="!editor.dirty || editor.saving"
                @click="editor.save()"
            />
        </div>
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

    const emit = defineEmits<{
        back : [];
    }>();

    const editor = useEditorStore();
    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    // The save-state line, in priority order: an error outranks everything, then an in-flight save, then unsaved edits,
    // then a settled "Saved" once at least one save has landed.
    const status = computed<string>(() =>
    {
        if(editor.saveError !== null) { return 'Couldn\'t save'; }
        if(editor.saving) { return 'Saving…'; }
        if(editor.dirty) { return 'Unsaved changes'; }
        if(editor.lastSavedAt !== null) { return 'Saved'; }
        return '';
    });

    const statusTone = computed(() =>
    {
        return editor.saveError !== null ? 'text-error' : 'text-dimmed';
    });

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
