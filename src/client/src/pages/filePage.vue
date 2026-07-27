<!----------------------------------------------------------------------------------------------------------------------
  -- File Page
  --
  -- The deep-linkable handler host at /file/:id, opened in its own tab. It resolves the routed node FIRST, asks the
  -- handler registry what opens it, and mounts that family: text or markdown editors (the markdown family is a page on a
  -- canvas; the text family is the editor store's card, framed here because a user-chosen theme's background reads as
  -- deliberate only inside a bordered, clipped card), the PDF annotator and media player (self-contained families that
  -- own their own chrome and save paths), or -- for natively-rendered types deep-linked here -- a redirect to the
  -- browser's own inline/download handling. It owns only what a page owns: resolving the routed node, the pre-resolution
  -- load/denied/error framing, and the Cmd/Ctrl+S shortcut for the editor path (the annotator binds its own). There is
  -- no Back button -- files open in a fresh tab, so the layout header logo (and "Go to my files" on a dead resolve) is
  -- the way out. Each mounted family contributes its own identity into the layout header; the text family's identity bar
  -- and control toolbar are mounted here beside it. Editing, saving, autosave, and conflict resolution live in the
  -- stores; the markdown family carries its own toolbar and conflict modal, the text family's are mounted here beside it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-full flex-col">
        <div
            v-if="phase === 'loading'"
            class="flex min-h-0 flex-1 items-center justify-center text-muted"
        >
            <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
        </div>

        <RequestAccess
            v-else-if="phase === 'denied' && fileID !== null"
            v-bind="{ nodeID: fileID }"
            class="min-h-0 flex-1"
            @back="goHome"
        />

        <div
            v-else-if="phase === 'error'"
            class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center"
        >
            <UIcon name="i-lucide-file-x" class="size-10 text-dimmed" />
            <p class="text-muted">
                {{ loadError ?? 'This file could not be opened.' }}
            </p>
            <UButton icon="i-lucide-hard-drive" label="Go to my files" color="neutral" @click="goHome" />
        </div>

        <PdfAnnotator
            v-else-if="action?.kind === 'annotate' && fileID !== null"
            v-bind="{ nodeID: fileID }"
            class="min-h-0 flex-1"
        />

        <MediaPlayer
            v-else-if="action?.kind === 'play-playlist' && node !== null"
            :node="node"
            playlist
            class="min-h-0 flex-1"
        />

        <MediaPlayer
            v-else-if="mediaKind !== null && node !== null"
            :node="node"
            :media="mediaKind"
            class="min-h-0 flex-1"
        />

        <template v-else-if="action?.kind === 'edit'">
            <div
                v-if="editor.loadState === 'loading'"
                class="flex min-h-0 flex-1 items-center justify-center text-muted"
            >
                <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
            </div>

            <div
                v-else-if="editor.loadState === 'error'"
                class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center"
            >
                <UIcon name="i-lucide-file-x" class="size-10 text-dimmed" />
                <p class="text-muted">
                    {{ editor.loadError ?? 'This file could not be opened.' }}
                </p>
                <UButton icon="i-lucide-hard-drive" label="Go to my files" color="neutral" @click="goHome" />
            </div>

            <MarkdownEditor
                v-else-if="isMarkdownFile"
                class="min-h-0 flex-1"
                :model-value="editor.buffer"
                :mode="editor.mode"
                :read-only="editor.readOnly"
                :theme="session.editorTheme"
                :gutter="session.editorGutter"
                @update:model-value="editor.setBuffer"
            />

            <template v-else>
                <TextIdentityBar />

                <div class="flex min-h-0 flex-1 justify-center p-4 sm:p-6">
                    <div class="flex min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-default">
                        <EditorToolbar />
                        <TextEditor
                            class="min-h-0 flex-1"
                            :model-value="editor.buffer"
                            :mode="editor.mode"
                            :read-only="editor.readOnly"
                            :theme="session.editorTheme"
                            :gutter="session.editorGutter"
                            @update:model-value="editor.setBuffer"
                        />
                    </div>
                </div>

                <ConflictModal
                    v-model:open="conflictOpen"
                    :busy="editor.saving"
                    @reload="editor.reload()"
                    @overwrite="editor.overwrite()"
                />
            </template>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';

    import type { NodeResponse } from '@fileshed/core';

    // Engines
    import { type OpenAction, defaultEditorMode, resolveOpen } from '../engines/intent/index.ts';

    // Stores
    import { useEditorStore } from '../stores/editor.ts';
    import { useSessionStore } from '../stores/session.ts';

    // Resource Access
    import { downloadUrl } from '../resource-access/downloads.ts';
    import { getNode } from '../resource-access/nodes.ts';

    // Components
    import EditorToolbar from '../components/handlers/text/toolbar.vue';
    import TextIdentityBar from '../components/handlers/text/identityBar.vue';
    import TextEditor from '../components/handlers/text/textEditor.vue';
    import ConflictModal from '../components/handlers/text/modals/conflictModal.vue';
    import RequestAccess from '../components/share/requestAccess.vue';

    // The heavier families load only when a file actually opens with them: pdf.js and TipTap stay out of the main
    // bundle, and nothing outside an opened file ever evaluates their module graphs.
    const MarkdownEditor = defineAsyncComponent(() => import('../components/handlers/markdown/markdownEditor.vue'));
    const PdfAnnotator = defineAsyncComponent(() => import('../components/handlers/pdf/pdfAnnotator.vue'));
    const MediaPlayer = defineAsyncComponent(() => import('../components/handlers/media/mediaPlayer.vue'));

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

    const fileID = computed<string | null>(routeFileID);

    //------------------------------------------------------------------------------------------------------------------
    // Resolution: fetch the routed node, ask the registry what opens it, mount that family.
    //------------------------------------------------------------------------------------------------------------------

    type Phase = 'loading' | 'ready' | 'denied' | 'error';

    const node = ref<NodeResponse | null>(null);
    const phase = ref<Phase>('loading');
    const loadError = ref<string | null>(null);

    const action = computed<OpenAction | null>(() =>
    {
        return node.value === null ? null : resolveOpen(node.value);
    });

    const mediaKind = computed<'video' | 'audio' | null>(() =>
    {
        return action.value?.kind === 'play' ? action.value.media : null;
    });

    const isMarkdownFile = computed(() =>
    {
        if(node.value === null || node.value.type !== 'file') { return false; }

        return defaultEditorMode(node.value.mimeType, node.value.name) === 'markdown';
    });

    async function load() : Promise<void>
    {
        const id = routeFileID();
        if(id === null) { return; }

        phase.value = 'loading';
        loadError.value = null;

        try
        {
            node.value = await getNode(id);
        }
        catch(error)
        {
            // The server answers 404 for both no-access and gone, so the denied framing (with its request-access
            // affordance) is the honest rendering of any failed resolve; other failures land on the plain error card.
            node.value = null;
            phase.value = 'denied';
            loadError.value = error instanceof Error ? error.message : null;

            return;
        }

        phase.value = 'ready';
    }

    // The registry's verdict decides the effectful path: the edit family runs through the editor store, and a
    // natively-handled deep link leaves the app for the browser's own renderer rather than mounting an empty shell.
    watch(action, (resolved) =>
    {
        if(resolved === null) { return; }

        const id = routeFileID();
        if(resolved.kind === 'edit' && id !== null) { void editor.open(id); }
        if(resolved.kind === 'view') { window.location.replace(downloadUrl(resolved.nodeID, 'inline')); }
        if(resolved.kind === 'download') { window.location.replace(downloadUrl(resolved.nodeID)); }
    }, { immediate: true });

    watch(() => route.params.id, () => { void load(); });

    //------------------------------------------------------------------------------------------------------------------

    const conflictOpen = computed<boolean>({
        get: () => editor.conflict,
        set: (open) => { if(!open) { editor.dismissConflict(); } },
    });

    // Files open in a fresh tab, so there is nowhere to go "back" to. The escape hatch is My Files -- the header logo
    // in the normal case, and this on a dead resolve where no family mounted.
    function goHome() : void
    {
        void router.push('/');
    }

    // Cmd/Ctrl+S saves for the editor families; the annotator binds its own shortcut, and a viewer's read-only session
    // has nothing to save.
    function onKeydown(event : KeyboardEvent) : void
    {
        if((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's')
        {
            event.preventDefault();
            if(action.value?.kind === 'edit' && !editor.readOnly) { void editor.save(); }
        }
    }

    onMounted(() =>
    {
        void load();
        window.addEventListener('keydown', onKeydown);
    });

    onUnmounted(() =>
    {
        window.removeEventListener('keydown', onKeydown);
        editor.reset();
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
