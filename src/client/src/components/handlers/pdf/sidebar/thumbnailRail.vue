<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Thumbnail Rail
  --
  -- One canvas per page, rasterized as it scrolls into view. A thousand-page document must not paint a thousand
  -- canvases to open its sidebar, so each page is painted on its first appearance and kept; rotating the document
  -- discards every painting and lets them come back the same way.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col items-center gap-3 p-3">
        <button
            v-for="page in store.pageCount"
            :key="page"
            ref="cells"
            type="button"
            :data-page="page"
            :aria-label="`Page ${ page }`"
            :aria-current="page === store.currentPage"
            class="flex w-full flex-col items-center gap-1 rounded-md p-1 outline-offset-2"
            :class="page === store.currentPage ? 'bg-elevated' : 'hover:bg-elevated/50'"
            @click="store.goToPage(page)"
        >
            <canvas
                :ref="(el) => holdCanvas(page, el)"
                class="block min-h-24 rounded-xs bg-white ring-1"
                :class="page === store.currentPage ? 'ring-primary' : 'ring-default'"
            />
            <span class="text-xs tabular-nums" :class="page === store.currentPage ? 'text-highlighted' : 'text-dimmed'">
                {{ page }}
            </span>
        </button>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

    // Stores
    import { usePdfAnnotatorStore } from '../../../../stores/pdfAnnotator.ts';

    // Components
    import { THUMBNAIL_WIDTH } from '../types.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfThumbnailRail' });

    const store = usePdfAnnotatorStore();

    const cells = ref<HTMLButtonElement[]>([]);
    const canvases = new Map<number, HTMLCanvasElement>();
    const painted = new Set<number>();

    let observer : IntersectionObserver | null = null;

    //------------------------------------------------------------------------------------------------------------------

    // Vue hands a template ref null when the element goes away, which is how a page leaving the list drops its canvas.
    function holdCanvas(page : number, element : unknown) : void
    {
        if(element instanceof HTMLCanvasElement) { canvases.set(page, element); }
        else { canvases.delete(page); painted.delete(page); }
    }

    async function paint(page : number) : Promise<void>
    {
        const canvas = canvases.get(page);
        if(canvas === undefined || painted.has(page)) { return; }

        // Claimed before the await, so two intersections in the same frame cannot both start a render into one canvas.
        painted.add(page);

        try { await store.renderThumbnail(page, canvas, THUMBNAIL_WIDTH); }
        catch { painted.delete(page); }
    }

    function onIntersect(entries : IntersectionObserverEntry[]) : void
    {
        for(const entry of entries.filter((candidate) => candidate.isIntersecting))
        {
            const page = Number.parseInt(entry.target.getAttribute('data-page') ?? '', 10);
            if(Number.isFinite(page)) { void paint(page); }
        }
    }

    // Re-observe after the page list changes: a fresh document has a different number of cells, and the old ones are
    // gone along with everything the observer was watching.
    async function observeCells() : Promise<void>
    {
        await nextTick();
        observer?.disconnect();
        for(const cell of cells.value) { observer?.observe(cell); }
    }

    //------------------------------------------------------------------------------------------------------------------

    onMounted(async () =>
    {
        // A generous vertical margin paints the pages just past each end of the rail, so an unhurried scroll meets
        // thumbnails that are already there rather than a column of blanks filling in behind it.
        observer = new IntersectionObserver(onIntersect, { root: null, rootMargin: '400px 0px' });
        await observeCells();
    });

    onBeforeUnmount(() =>
    {
        observer?.disconnect();
        observer = null;
    });

    watch(() => store.pageCount, () =>
    {
        painted.clear();
        void observeCells();
    });

    // A rotated document's thumbnails turn with it, which means every painting is now wrong.
    watch(() => store.rotation, async () =>
    {
        painted.clear();
        await observeCells();
    });

    // Follow the reader: scrolling the surface moves the rail's highlight, and the highlight should stay on screen.
    watch(() => store.currentPage, async (page) =>
    {
        await nextTick();
        cells.value.find((cell) => cell.getAttribute('data-page') === String(page))
            ?.scrollIntoView({ block: 'nearest' });
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
