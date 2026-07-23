<!----------------------------------------------------------------------------------------------------------------------
  -- Search Page
  --
  -- Name search across every file and folder the caller can see. The route's `q` query param is the source of truth
  -- for the active term -- the same pattern the drive uses for its folder param -- so a fresh submission from the top
  -- bar's search box while already on this page re-queries instead of doing nothing. A blank or missing term shows a
  -- prompt rather than calling the search endpoint, which would 400 on an empty query anyway.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section class="flex h-full flex-col gap-4">
        <header class="shrink-0">
            <h1 class="text-2xl font-bold">
                Search
            </h1>
            <p class="mt-1 text-sm text-muted">
                Files and folders matching your search, scoped to what you can see.
            </p>
        </header>

        <div
            v-if="term.length === 0"
            class="flex h-64 flex-col items-center justify-center gap-3 text-center text-dimmed"
        >
            <UIcon name="i-lucide-search" class="size-10" />
            <p>Type something in the search box to find your files.</p>
        </div>

        <SearchSurface v-else class="min-h-0 flex-1" @open="onOpen" />
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';

    import type { NodeResponse } from '@fileshed/core';

    // Stores
    import { useSearchStore } from '../stores/search.ts';

    // Resource Access
    import { downloadUrl } from '../resource-access/downloads.ts';

    // Components
    import SearchSurface from '../components/search/searchSurface.vue';

    // Engines
    import { intent } from '../engines/intent/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useSearchStore();
    const route = useRoute();
    const router = useRouter();

    const term = computed(() =>
    {
        const raw = route.query.q;
        return typeof raw === 'string' ? raw.trim() : '';
    });

    watch(term, (value) =>
    {
        if(value.length > 0) { void store.load(value); }
        else { store.clear(); }
    }, { immediate: true });

    //------------------------------------------------------------------------------------------------------------------
    // Open -- the same handler seam the drive and Shared with me use. A folder navigates in, a browser-renderable file
    // opens in a new tab, an editable text file opens in the in-app editor, anything else downloads.
    //------------------------------------------------------------------------------------------------------------------

    function onOpen(node : NodeResponse) : void
    {
        const action = intent.handlers.resolveOpen(node);
        switch (action.kind)
        {
            case 'navigate': void router.push(`/folder/${ action.folderID }`); break;
            case 'edit': void router.push(`/file/${ action.nodeID }`); break;
            case 'annotate': void router.push(`/file/${ action.nodeID }`); break;
            case 'play': void router.push(`/file/${ action.nodeID }`); break;
            case 'view': window.open(downloadUrl(action.nodeID, 'inline'), '_blank'); break;
            case 'download': window.open(downloadUrl(action.nodeID), '_blank'); break;
            case 'none': break;
        }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
