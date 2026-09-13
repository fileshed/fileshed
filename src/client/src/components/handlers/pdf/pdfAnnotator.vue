<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Annotator
  --
  -- The root of the PDF handler family and its single mount point: the host mounts exactly this, and everything below
  -- it (toolbar, sidebar, render surface, modals, the byte-save store, the pdf.js binding) is internal. It plays the
  -- same role for a PDF that filePage plays for the text editor -- load the file, frame loading/error, own the card
  -- that contains the chrome, own the keyboard map, and reset on leave -- but folds that role into one component so a
  -- host can drop `<PdfAnnotator :node-id="id" />` in without knowing the family's internals.
  --
  -- pdf.js is an annotator, not a content editor: it lays free text, ink, highlight and image marks over the page and
  -- fills AcroForm fields, then saveDocument serializes those as an incremental update to the original bytes. It never
  -- rewrites existing page content.
  --
  -- Mount contract:
  --   prop  nodeID : string   The file node to open for annotation. Opened on mount and re-opened when it changes, so
  --                           one mounted instance can follow a deep-link swap. An over-cap or non-PDF-file node is
  --                           refused gracefully with an inline error rather than mounting a renderer over it.
  -- The host provides nothing else: the identity chrome teleports into the layout header (the PDF identity bar), and
  -- annotation, navigation, saving, and conflict resolution all live in the store; a viewer lands here too and gets the
  -- same surface, read-only. There is no Back button -- the header logo is the way out of the tab.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-full flex-col" @keydown="onCardKeydown">
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
                <PdfToolbar @present="present" />

                <div class="flex min-h-0 flex-1">
                    <PdfSidebar v-if="store.sidebarOpen" />
                    <PdfSurface ref="surface" class="min-h-0 flex-1" />
                </div>
            </template>
        </div>

        <PdfAltText />

        <PdfDocumentProperties />

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
    import { computed, onMounted, onUnmounted, useTemplateRef, watch } from 'vue';
    import { useRouter } from 'vue-router';
    import { useToast } from '@nuxt/ui/composables';

    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import ConflictModal from '../text/modals/conflictModal.vue';
    import PdfAltText from './modals/altText.vue';
    import PdfDocumentProperties from './modals/documentProperties.vue';
    import PdfIdentityBar from './identityBar.vue';
    import PdfSidebar from './sidebar/sidebar.vue';
    import PdfSurface from './pdfSurface.vue';
    import PdfToolbar from './toolbar.vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        nodeID : string;
    }>();

    const store = usePdfAnnotatorStore();
    const router = useRouter();
    const toast = useToast();

    const surface = useTemplateRef<InstanceType<typeof PdfSurface>>('surface');

    //------------------------------------------------------------------------------------------------------------------

    const conflictOpen = computed<boolean>({
        get: () => store.conflict,
        set: (open) => { if(!open) { store.dismissConflict(); } },
    });

    function goHome() : void
    {
        void router.push('/');
    }

    function present() : void
    {
        void surface.value?.present();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Keyboard
    //------------------------------------------------------------------------------------------------------------------

    // Typing a page number, a search term, or a free-text annotation must not also page the document.
    function isTyping(target : EventTarget | null) : boolean
    {
        if(!(target instanceof HTMLElement)) { return false; }

        return target.isContentEditable || [ 'INPUT', 'TEXTAREA', 'SELECT' ].includes(target.tagName);
    }

    // The bindings that must beat the browser's own: Save, Find, and the editor history. These are on the window
    // because a reader who has just clicked a thumbnail has focus in the sidebar, and the gesture still means save.
    function onWindowKeydown(event : KeyboardEvent) : void
    {
        if(!(event.metaKey || event.ctrlKey)) { return; }

        const key = event.key.toLowerCase();

        if(key === 's')
        {
            event.preventDefault();
            if(!store.readOnly) { void store.save(); }
        }
        else if(key === 'f')
        {
            event.preventDefault();
            store.openFind();
        }
        else if(key === 'z' && !store.readOnly && !isTyping(event.target))
        {
            event.preventDefault();
            if(event.shiftKey) { store.redo(); }
            else { store.undo(); }
        }
    }

    // Mozilla's viewer map, for the keys that carry no modifier: page with the arrows or n/p, jump to the ends with
    // Home and End, zoom with +/-, rotate with r, toggle the sidebar with F4. Scoped to the card, so a reader whose
    // focus is elsewhere in the app keeps their own keyboard.
    function onCardKeydown(event : KeyboardEvent) : void
    {
        if(event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) { return; }

        const handlers : Record<string, () => void> = {
            'ArrowRight': () => { store.nextPage(); },
            'ArrowDown': () => { store.nextPage(); },
            'n': () => { store.nextPage(); },
            'j': () => { store.nextPage(); },
            'ArrowLeft': () => { store.prevPage(); },
            'ArrowUp': () => { store.prevPage(); },
            'p': () => { store.prevPage(); },
            'k': () => { store.prevPage(); },
            'Home': () => { store.firstPage(); },
            'End': () => { store.lastPage(); },
            '+': () => { store.zoomIn(); },
            '=': () => { store.zoomIn(); },
            '-': () => { store.zoomOut(); },
            'r': () => { store.rotateCW(); },
            'R': () => { store.rotateCCW(); },
            'F4': () => { store.toggleSidebar(); },
        };

        const handler = handlers[event.key];
        if(handler === undefined) { return; }

        // Arrow keys scroll the surface by default, and paging is the stronger reading of them here; the surface's own
        // scrollbar still works with the pointer and with the space bar.
        event.preventDefault();
        handler();
    }

    //------------------------------------------------------------------------------------------------------------------

    // A blocked print tab is the one failure the reader cannot see any other way -- the new tab simply never appears.
    watch(() => store.printError, (message) =>
    {
        if(message !== null) { toast.add({ title: 'Couldn\'t print', description: message, color: 'error' }); }
    });

    // The prop is the source of truth; re-opening on change lets one instance follow a deep-link swap.
    watch(() => props.nodeID, (id) => { void store.open(id); });

    onMounted(() =>
    {
        void store.open(props.nodeID);
        window.addEventListener('keydown', onWindowKeydown);
    });

    onUnmounted(() =>
    {
        window.removeEventListener('keydown', onWindowKeydown);
        store.reset();
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
