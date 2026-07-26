<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Annotator
  --
  -- The root of the PDF handler family and its single mount point: the host mounts exactly this, and everything below
  -- it (toolbar, render surface, conflict modal, the byte-save store, the pdf.js binding) is internal. It plays the same
  -- role for a PDF that filePage plays for the text editor -- load the file, frame loading/error, own the card that
  -- contains the chrome, own Cmd/Ctrl+S, and reset on leave -- but folds that role into one component so the later
  -- registry pass can drop `<PdfAnnotator :node-id="id" @back="..." />` in without knowing the family's internals.
  --
  -- pdf.js is an annotator, not a content editor: it lays free text, ink, and highlight marks over the page and fills
  -- AcroForm fields, then saveDocument serializes those as an incremental update to the original bytes. It never
  -- rewrites existing page content.
  --
  -- Mount contract:
  --   prop  nodeID : string   The file node to open for annotation. Opened on mount and re-opened when it changes, so
  --                           one mounted instance can follow a deep-link swap. An over-cap or non-PDF-file node is
  --                           refused gracefully with an inline error rather than mounting a renderer over it.
  -- The host provides nothing else: the identity chrome teleports into the layout header (the PDF identity bar), and
  -- annotation, zoom, page, saving, and conflict resolution all live in the store; a viewer lands here too and gets the
  -- same surface, read-only. There is no Back button -- the header logo is the way out of the tab.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-full flex-col" @keydown="onRootKeydown">
        <PdfIdentityBar />

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-default">
            <div v-if="store.loadState === 'loading'" class="flex flex-1 items-center justify-center text-muted">
                <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
            </div>

            <div
                v-else-if="store.loadState === 'error'"
                class="flex flex-1 flex-col items-center justify-center gap-4 text-center"
            >
                <UIcon name="i-lucide-file-x" class="size-10 text-dimmed" />
                <p class="text-muted">
                    {{ store.loadError ?? 'This file could not be opened.' }}
                </p>
                <UButton icon="i-lucide-hard-drive" label="Go to my files" color="neutral" @click="goHome" />
            </div>

            <template v-else>
                <PdfToolbar />
                <PdfSurface class="min-h-0 flex-1" />
            </template>
        </div>

        <ConflictModal
            v-model:open="conflictOpen"
            :busy="store.saving"
            @reload="store.reload()"
            @overwrite="store.overwrite()"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, onUnmounted, watch } from 'vue';
    import { useRouter } from 'vue-router';

    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import PdfIdentityBar from './identityBar.vue';
    import PdfToolbar from './toolbar.vue';
    import PdfSurface from './pdfSurface.vue';
    import ConflictModal from '../text/modals/conflictModal.vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        nodeID : string;
    }>();

    const store = usePdfAnnotatorStore();
    const router = useRouter();

    //------------------------------------------------------------------------------------------------------------------

    const conflictOpen = computed<boolean>({
        get: () => store.conflict,
        set: (open) => { if(!open) { store.dismissConflict(); } },
    });

    function goHome() : void
    {
        void router.push('/');
    }

    // Cmd/Ctrl+S saves, pre-empting the browser's Save Page. A viewer's read-only session has nothing to save.
    function onKeydown(event : KeyboardEvent) : void
    {
        if((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's')
        {
            event.preventDefault();
            if(!store.readOnly) { void store.save(); }
        }
    }

    // Cmd/Ctrl+F opens the find bar, pre-empting the browser's own find. Scoped to the annotator: the handler sits on
    // the card, so it only fires while focus is inside the PDF surface -- outside it, the browser's find is untouched.
    function onRootKeydown(event : KeyboardEvent) : void
    {
        if((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f')
        {
            event.preventDefault();
            store.openFind();
        }
    }

    // The prop is the source of truth; re-opening on change lets one instance follow a deep-link swap.
    watch(() => props.nodeID, (id) => { void store.open(id); });

    onMounted(() =>
    {
        void store.open(props.nodeID);
        window.addEventListener('keydown', onKeydown);
    });

    onUnmounted(() =>
    {
        window.removeEventListener('keydown', onKeydown);
        store.reset();
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
