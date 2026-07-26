<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Surface
  --
  -- The scrolling render surface: a positioned container pdf.js's PDFViewer paints into, page by page, lazily. It owns
  -- one live pdf.js session (see pdfjs.ts) over the store's loaded bytes and is otherwise driven entirely by the store --
  -- it reads the bytes, the read-only flag, the annotation mode, and the zoom, and it reports the scrolled-to page and
  -- the unsaved-marks flag back. A reload swaps the store's bytes, which tears the old session down and mounts a fresh
  -- one, so in-progress annotations are dropped exactly as a conflict reload intends. The session's saveDocument is
  -- registered as the store's save source, the single place bytes cross back out of the renderer.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="relative size-full">
        <div ref="container" class="absolute inset-0 overflow-auto bg-muted">
            <div ref="viewer" class="pdfViewer" />
        </div>

        <div
            v-if="renderError !== null"
            class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-default text-center"
        >
            <UIcon name="i-lucide-file-x" class="size-10 text-dimmed" />
            <p class="text-muted">
                {{ renderError }}
            </p>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

    import 'pdfjs-dist/web/pdf_viewer.css';

    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import { type PdfSession, openPdfSession } from './pdfjs.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfSurface' });

    const store = usePdfAnnotatorStore();

    const container = ref<HTMLDivElement | null>(null);
    const viewer = ref<HTMLDivElement | null>(null);
    const renderError = ref<string | null>(null);

    let session : PdfSession | null = null;

    // Bumped on every (re)mount so a session that finishes loading after its bytes were already superseded tears itself
    // down instead of attaching a stale document.
    let generation = 0;

    //------------------------------------------------------------------------------------------------------------------

    function teardown() : void
    {
        store.setSaveSource(null);
        session?.destroy();
        session = null;
    }

    async function mount() : Promise<void>
    {
        const gen = ++generation;
        teardown();
        renderError.value = null;

        const data = store.bytes;
        if(data === null || container.value === null || viewer.value === null) { return; }

        try
        {
            const active = await openPdfSession({
                container: container.value,
                viewer: viewer.value,
                data,
                readOnly: store.readOnly,
                callbacks: {
                    onPage: (current, total) => { store.setPage(current, total); },
                    onDirty: (dirty) => { store.setDirty(dirty); },
                    onFind: (current, total) => { store.setFindResult(current, total); },
                },
            });

            if(gen !== generation) { active.destroy(); return; }

            session = active;
            store.setSaveSource(() => active.save());
            active.setMode(store.mode);
            active.setZoom(store.zoom);
            active.setRotation(store.rotation);
            active.setParams(store.editorParams);
        }
        catch(error)
        {
            console.error('pdf session failed:', error);
            if(gen === generation) { renderError.value = 'This PDF couldn\'t be opened for annotation.'; }
        }
    }

    //------------------------------------------------------------------------------------------------------------------

    onMounted(mount);
    onBeforeUnmount(teardown);

    // A bytes swap is a reload: rebuild the session over the new document.
    watch(() => store.bytes, mount);

    watch(() => store.mode, (mode) => { session?.setMode(mode); });
    watch(() => store.zoom, (zoom) => { session?.setZoom(zoom); });
    watch(() => store.rotation, (degrees) => { session?.setRotation(degrees); });
    watch(() => store.editorParams, (params) => { session?.setParams(params); }, { deep: true });

    watch(() => store.pageRequest, (request) => { if(request !== null) { session?.setPage(request.page); } });
    watch(() => store.findRequest, (request) => { if(request !== null) { session?.find(request); } });
    watch(() => store.findOpen, (open) => { if(!open) { session?.clearFind(); } });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
