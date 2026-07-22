<!----------------------------------------------------------------------------------------------------------------------
  -- File Page
  --
  -- The full-page, deep-linkable editor at /file/:id, and the file editor's handler host: it mounts the handler for the
  -- open file's type -- today the text (CodeMirror) family under components/handlers/text/ (toolbar, editing surface,
  -- conflict modal) -- and is the seam where further file-type handlers (a rich Markdown editor, a PDF annotator) will
  -- mount as the open-intent vocabulary grows. It owns only what a page owns: loading the routed file, resetting on
  -- leave, back navigation, the Cmd/Ctrl+S shortcut, the load/error framing, and the card that frames the toolbar and
  -- editing surface as one contained document -- since a user-chosen theme's background rarely matches the app chrome,
  -- the bordered, clipped card is what makes a foreign background read as deliberate rather than a glitch. Editing,
  -- saving, autosave, and conflict resolution all live in the store; a viewer lands here too and gets the same surface,
  -- read-only.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-full flex-col">
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-default">
            <div v-if="editor.loadState === 'loading'" class="flex flex-1 items-center justify-center text-muted">
                <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
            </div>

            <div
                v-else-if="editor.loadState === 'error'"
                class="flex flex-1 flex-col items-center justify-center gap-4 text-center"
            >
                <UIcon name="i-lucide-file-x" class="size-10 text-dimmed" />
                <p class="text-muted">
                    {{ editor.loadError ?? 'This file could not be opened.' }}
                </p>
                <UButton icon="i-lucide-arrow-left" label="Back to files" color="neutral" @click="goBack" />
            </div>

            <template v-else>
                <EditorToolbar @back="goBack" />
                <TextEditor
                    class="min-h-0 flex-1"
                    :model-value="editor.buffer"
                    :mode="editor.mode"
                    :read-only="editor.readOnly"
                    :theme="session.editorTheme"
                    :gutter="session.editorGutter"
                    @update:model-value="editor.setBuffer"
                />
            </template>
        </div>

        <ConflictModal
            v-model:open="conflictOpen"
            :busy="editor.saving"
            @reload="editor.reload()"
            @overwrite="editor.overwrite()"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, onUnmounted, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';

    // Stores
    import { useEditorStore } from '../stores/editor.ts';
    import { useSessionStore } from '../stores/session.ts';

    // Components
    import EditorToolbar from '../components/handlers/text/toolbar.vue';
    import TextEditor from '../components/handlers/text/textEditor.vue';
    import ConflictModal from '../components/handlers/text/modals/conflictModal.vue';

    //------------------------------------------------------------------------------------------------------------------

    const route = useRoute();
    const router = useRouter();
    const editor = useEditorStore();
    const session = useSessionStore();

    function routeFileID() : string | null
    {
        const { id } = route.params;
        return typeof id === 'string' && id.length > 0 ? id : null;
    }

    function load() : void
    {
        const id = routeFileID();
        if(id !== null) { void editor.open(id); }
    }

    // The param is the source of truth; re-loading on change lets one editor instance follow a deep-link swap.
    watch(() => route.params.id, load);

    //------------------------------------------------------------------------------------------------------------------

    const conflictOpen = computed<boolean>({
        get: () => editor.conflict,
        set: (open) => { if(!open) { editor.dismissConflict(); } },
    });

    function goBack() : void
    {
        const parentID = editor.node?.parentID ?? null;
        void router.push(parentID === null ? '/' : `/folder/${ parentID }`);
    }

    // Cmd/Ctrl+S saves, pre-empting the browser's Save Page. A viewer's read-only session has nothing to save.
    function onKeydown(event : KeyboardEvent) : void
    {
        if((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's')
        {
            event.preventDefault();
            if(!editor.readOnly) { void editor.save(); }
        }
    }

    onMounted(() =>
    {
        load();
        window.addEventListener('keydown', onKeydown);
    });

    onUnmounted(() =>
    {
        window.removeEventListener('keydown', onKeydown);
        editor.reset();
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
