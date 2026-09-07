<!----------------------------------------------------------------------------------------------------------------------
  -- Search Page
  --
  -- Name search across every file and folder the caller can see. The route's `q` query param is the source of truth
  -- for the active term -- the same pattern the drive uses for its folder param -- so a fresh submission from the top
  -- bar's search box while already on this page re-queries instead of doing nothing. A blank or missing term shows a
  -- prompt rather than calling the search endpoint, which would 400 on an empty query anyway.
  --
  -- Selection works here exactly as it does on the drive, down to the engine that decides it, so a set of hits
  -- scattered across folders can be dealt with where they were found. Two actions, and they are the two that mean
  -- something when the selection spans folders and owners: Trash, and Copy into the caller's own root. Move needs a
  -- destination the drive's picker owns, and Rename and Share act on one node in one place -- all three are a
  -- go-to-folder jump away, which every row offers.
  --
  -- The caps come from the same engine the drive's bar answers to, so a viewer's grant withholds Trash here for the
  -- same reason it does there, and Copy -- which asks only read access -- survives.
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

        <template v-else>
            <div v-if="selectedNodes.length > 0" class="flex h-12 shrink-0 items-center">
                <SelectionBar
                    :count="selectedNodes.length"
                    :can-copy="canCopy"
                    :copy-tooltip="copyTooltip"
                    :can-rename="false"
                    :can-share="false"
                    :can-move="false"
                    :can-trash="canTrash"
                    :trash-label="trashLabel"
                    @clear="clearSelection"
                    @copy="copySelected"
                    @trash="trashSelected"
                />
            </div>

            <SearchSurface
                class="min-h-0 flex-1"
                :selection="selection.selected"
                @select="onSelect"
                @open="onOpen"
                @clear-empty="clearSelection"
            />
        </template>
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
    import { useRoute } from 'vue-router';
    import { useToast } from '@nuxt/ui/composables';

    import type { NodeResponse } from '@fileshed/core';

    // Stores
    import { useSearchStore } from '../stores/search.ts';
    import { useSessionStore } from '../stores/session.ts';

    // Components
    import SearchSurface from '../components/search/searchSurface.vue';
    import SelectionBar from '../components/drive/selectionBar.vue';

    // Engines
    import { type SelectionState, intent } from '../engines/intent/index.ts';

    // Utils
    import { useOpenNode } from '../utils/openNode.ts';
    import { useRunWithToast } from '../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useSearchStore();
    const session = useSessionStore();
    const route = useRoute();
    const toast = useToast();
    const { perform } = useOpenNode();
    const { runMutation } = useRunWithToast();

    const selection = ref<SelectionState>(intent.selection.emptySelection());

    const term = computed(() =>
    {
        const raw = route.query.q;
        return typeof raw === 'string' ? raw.trim() : '';
    });

    watch(term, (value) =>
    {
        selection.value = intent.selection.emptySelection();

        if(value.length > 0) { void store.load(value); }
        else { store.clear(); }
    }, { immediate: true });

    // Trim the selection to what a re-run still returns: a trashed hit leaves the results, and holding its id would
    // keep it counted in a bar that can no longer act on it.
    watch(() => store.nodes, () =>
    {
        selection.value = intent.selection.reconcile(selection.value, store.nodes.map((node) => node.id));
    });

    //------------------------------------------------------------------------------------------------------------------
    // Selection
    //------------------------------------------------------------------------------------------------------------------

    const orderedIDs = computed(() => store.nodes.map((node) => node.id));
    const selectedNodes = computed(() => store.nodes.filter((node) => selection.value.selected.has(node.id)));

    // Direct ownership (node.ownerID), never the resolved `role` -- a folder owner reads a contribution placed in
    // their own folder as role 'owner' but does not administer it, and the server would refuse what role alone offers.
    const currentUserID = computed(() => session.me?.id ?? null);

    const canCopy = computed(() => intent.selection.canCopySelection(selectedNodes.value));
    const copyTooltip = computed(() =>
    {
        return canCopy.value ? 'Save a copy in your files' : 'Folders can\'t be copied';
    });
    const canTrash = computed(() => intent.selection.ownsSelection(selectedNodes.value, currentUserID.value));
    const trashLabel = computed(() =>
    {
        return intent.selection.planTrash(selectedNodes.value).mode === 'remove' ? 'Remove' : 'Trash';
    });

    function onSelect(node : NodeResponse, event : MouseEvent) : void
    {
        selection.value = intent.selection.applyClick(selection.value, orderedIDs.value, node.id, {
            toggle: event.metaKey || event.ctrlKey,
            range: event.shiftKey,
        });
    }

    function clearSelection() : void
    {
        selection.value = intent.selection.clearSelection();
    }

    function onKeydown(event : KeyboardEvent) : void
    {
        if(event.key === 'Escape') { clearSelection(); }
    }

    onMounted(() => window.addEventListener('keydown', onKeydown));
    onUnmounted(() => window.removeEventListener('keydown', onKeydown));

    //------------------------------------------------------------------------------------------------------------------
    // Actions
    //------------------------------------------------------------------------------------------------------------------

    // Into the caller's own root: this surface has no open folder to copy into, and a hit found by search is as
    // likely to live in somebody else's folder as their own.
    function copySelected() : void
    {
        if(!canCopy.value) { return; }

        const targets = selectedNodes.value.map((node) => node.id);
        void runMutation(async () =>
        {
            for(const id of targets)
            {
                // eslint-disable-next-line no-await-in-loop -- each copy re-reads the results before the next
                await store.copy(id);
            }
        });
    }

    // A links-only selection is removed; otherwise files and folders are trashed and any links are reported as left
    // in place -- links are never trashable, and Remove is irreversible.
    function trashSelected() : void
    {
        if(!canTrash.value) { return; }

        const plan = intent.selection.planTrash(selectedNodes.value);
        const targets = [ ...plan.targetIDs ];
        if(targets.length === 0) { return; }

        void runMutation(
            async () =>
            {
                for(const id of targets)
                {
                    // eslint-disable-next-line no-await-in-loop -- each removal re-reads the results before the next
                    await (plan.mode === 'remove' ? store.removeDeadLink(id) : store.trash(id));
                }
            },
            undefined,
            () =>
            {
                if(plan.mode === 'trash' && plan.skippedLinks > 0)
                {
                    const count = plan.skippedLinks;
                    toast.add({
                        title: 'Links were left in place',
                        description: `${ count } link${ count === 1 ? '' : 's' } can't be trashed. `
                            + 'Remove links from the folder they live in.',
                        color: 'info',
                    });
                }
            }
        );
    }

    //------------------------------------------------------------------------------------------------------------------
    // Open -- the same handler seam the drive and Shared with me use.
    //------------------------------------------------------------------------------------------------------------------

    function onOpen(node : NodeResponse) : void
    {
        perform(intent.handlers.resolveOpen(node));
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
