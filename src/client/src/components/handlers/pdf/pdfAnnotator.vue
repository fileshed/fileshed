<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Annotator
  --
  -- The PDF family's single mount point. Everything under it is internal, so a host mounts `<PDFAnnotator :node-id="id"
  -- />` without knowing the family's parts.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-full flex-col" @keydown="onCardKeydown">
        <PDFIdentityBar />

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
                <PDFToolbar @present="present" />

                <div class="flex min-h-0 flex-1">
                    <PDFSidebar v-if="store.sidebarOpen" />
                    <PDFSurface ref="surface" class="min-h-0 flex-1" />
                </div>
            </template>
        </div>

        <PDFAltText />

        <PDFDocumentProperties />

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
    import { usePDFAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import ConflictModal from '../text/modals/conflictModal.vue';
    import PDFAltText from './modals/altText.vue';
    import PDFDocumentProperties from './modals/documentProperties.vue';
    import PDFIdentityBar from './identityBar.vue';
    import PDFSidebar from './sidebar/sidebar.vue';
    import PDFSurface from './pdfSurface.vue';
    import PDFToolbar from './toolbar.vue';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        nodeID : string;
    }>();

    const store = usePDFAnnotatorStore();
    const router = useRouter();
    const toast = useToast();

    const surface = useTemplateRef<InstanceType<typeof PDFSurface>>('surface');

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
