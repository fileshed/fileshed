<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Surface
  --
  -- The scrolling render surface: a positioned container pdf.js's PDFViewer paints into, page by page, lazily. It owns
  -- one live pdf.js session (see pdfjs.ts) over the store's loaded bytes and is otherwise driven entirely by the store
  -- -- it reads the bytes, the read-only flag, the annotation mode, the zoom, and the layout, and it reports the
  -- scrolled-to page, the unsaved-marks flag, and the document's own facts back. A reload swaps the store's bytes,
  -- which tears the old session down and mounts a fresh one, so in-progress annotations are dropped exactly as a
  -- conflict reload intends.
  --
  -- The session is registered as the store's document access, the one place anything outside this component reaches
  -- the renderer.
  --
  -- Two behaviors are the surface's own and never reach pdf.js: dragging the page to scroll it (the pan cursor tool),
  -- and filling the screen. Full screen is reported back to the store only once the browser confirms it, because a
  -- reader can leave it by pressing Escape, which this app is never asked about.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="relative size-full">
        <div
            ref="container"
            class="absolute inset-0 overflow-auto bg-muted"
            :class="panning ? 'cursor-grabbing select-none' : (store.cursorTool === 'pan' ? 'cursor-grab' : '')"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
        >
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

<style scoped>
    /*
     * pdf.js scales the annotation editor layer's font with the zoom -- `font-size: calc(100px * scale)` -- so a
     * free-text annotation can size itself in em against the page. The toolbar that appears on a selected annotation
     * is a descendant of that layer and inherits it, and its icons are inline-block pseudo-elements that sit on the
     * text baseline: at a 1.67x zoom the button inherits a 167px font and a 250px line box, and the trash icon paints
     * some 170px below the button it belongs to, leaving an empty square in the toolbar.
     *
     * The components stylesheet npm ships resets none of this -- it carries no font declaration for the toolbar at
     * all -- so the viewer application's stylesheet, which npm does not ship, is where Mozilla handles it. Every size
     * in the toolbar's own CSS is in px, so pinning the font costs it nothing.
     */
    :deep(.editToolbar) {
        font-size: 1rem;
        line-height: 1;
    }

    /*
     * pdf.js's stylesheet is written against the browser's default content-box model: a page is the page's own width
     * plus a 9px transparent border that draws the gutter around it. Tailwind's preflight sets `box-sizing:
     * border-box` on every element, which takes those 18px out of the page's content box -- so the canvas, which is
     * in flow, shrinks to fit, while the text and annotation layers, which carry their own explicit width, do not.
     * The layers end up 18px larger than the page they sit on, and everything positioned in them drifts further from
     * the glyphs the further down and right it is: search highlights beside their words, selection off its text.
     *
     * The renderer's own subtree gets the box model its stylesheet was written for. Nothing of ours renders inside
     * it -- it is pdf.js's DOM from .pdfViewer down.
     */
    :deep(.pdfViewer),
    :deep(.pdfViewer *) {
        box-sizing: content-box;
    }
</style>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

    import 'pdfjs-dist/web/pdf_viewer.css';

    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    // Components
    import type { ScrollModeName, SpreadModeName } from './types.ts';
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
    // Session
    //------------------------------------------------------------------------------------------------------------------

    function teardown() : void
    {
        store.setDocumentAccess(null);
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
                    onEditorHistory: (canUndo, canRedo) => { store.setEditorHistory(canUndo, canRedo); },
                    onAltText: (request) => { store.openAltText(request); },
                },
            });

            if(gen !== generation) { active.destroy(); return; }

            session = active;
            store.setDocumentAccess({
                save: () => active.save(),
                serialize: () => active.serialize(),
                renderThumbnail: (page, canvas, width) => active.renderThumbnail(page, canvas, width),
                readAttachment: (filename) => active.readAttachment(filename),
                goToDestination: (dest) => { active.goToDestination(dest); },
                addImage: () => { active.addImage(); },
                undo: () => { active.undo(); },
                redo: () => { active.redo(); },
            });
            store.setDocumentFacts({
                outline: active.outline,
                attachments: active.attachments,
                properties: active.properties,
            });

            active.setMode(store.mode);
            active.setZoom(store.zoom);
            active.setRotation(store.rotation);
            active.setScrollMode(store.scrollMode);
            active.setSpreadMode(store.spreadMode);
            active.setParams(store.editorParams);
        }
        catch(error)
        {
            console.error('pdf session failed:', error);
            if(gen === generation) { renderError.value = 'This PDF couldn\'t be opened for annotation.'; }
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Pan
    //------------------------------------------------------------------------------------------------------------------

    const panning = ref(false);
    let origin = { x: 0, y: 0, left: 0, top: 0 };

    // Only the primary button drags, and only with the pan tool armed -- with the select tool the text layer owns the
    // gesture, which is how text is selected and copied.
    function onPointerDown(event : PointerEvent) : void
    {
        const element = container.value;
        if(element === null || store.cursorTool !== 'pan' || event.button !== 0) { return; }

        panning.value = true;
        origin = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
        element.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    function onPointerMove(event : PointerEvent) : void
    {
        const element = container.value;
        if(!panning.value || element === null) { return; }

        element.scrollLeft = origin.left - (event.clientX - origin.x);
        element.scrollTop = origin.top - (event.clientY - origin.y);
    }

    function onPointerUp(event : PointerEvent) : void
    {
        if(!panning.value) { return; }

        panning.value = false;
        container.value?.releasePointerCapture(event.pointerId);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Full screen
    //------------------------------------------------------------------------------------------------------------------

    // What the document looked like before it filled the screen, so leaving puts it back rather than stranding the
    // reader in one-page-at-a-time at a scale they never chose.
    interface PresentationState
    {
        scrollMode : ScrollModeName;
        spreadMode : SpreadModeName;
        zoom : string;
    }

    let beforePresenting : PresentationState | null = null;

    async function present() : Promise<void>
    {
        const element = container.value;
        if(element === null || document.fullscreenElement !== null) { return; }

        beforePresenting = { scrollMode: store.scrollMode, spreadMode: store.spreadMode, zoom: store.zoom };

        try { await element.requestFullscreen(); }
        catch { beforePresenting = null; return; }

        store.setScrollMode('page');
        store.setSpreadMode('none');
        store.setZoom('page-fit');
    }

    function onFullscreenChange() : void
    {
        const active = document.fullscreenElement === container.value;
        store.setPresenting(active);

        if(active || beforePresenting === null) { return; }

        store.setScrollMode(beforePresenting.scrollMode);
        store.setSpreadMode(beforePresenting.spreadMode);
        store.setZoom(beforePresenting.zoom);
        beforePresenting = null;
    }

    defineExpose({ present });

    //------------------------------------------------------------------------------------------------------------------

    onMounted(() =>
    {
        void mount();
        document.addEventListener('fullscreenchange', onFullscreenChange);
    });

    onBeforeUnmount(() =>
    {
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        teardown();
    });

    // A bytes swap is a reload: rebuild the session over the new document.
    watch(() => store.bytes, mount);

    watch(() => store.mode, (mode) => { session?.setMode(mode); });
    watch(() => store.zoom, (zoom) => { session?.setZoom(zoom); });
    watch(() => store.rotation, (degrees) => { session?.setRotation(degrees); });
    watch(() => store.scrollMode, (mode) => { session?.setScrollMode(mode); });
    watch(() => store.spreadMode, (mode) => { session?.setSpreadMode(mode); });
    watch(() => store.editorParams, (params) => { session?.setParams(params); }, { deep: true });

    watch(() => store.pageRequest, (request) => { if(request !== null) { session?.setPage(request.page); } });
    watch(() => store.findRequest, (request) => { if(request !== null) { session?.find(request); } });
    watch(() => store.findOpen, (open) => { if(!open) { session?.clearFind(); } });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
