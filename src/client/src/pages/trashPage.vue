<!----------------------------------------------------------------------------------------------------------------------
  -- Trash Page
  --
  -- The Trash view: pending deletion offers up top (self-hiding when there are none), a retention banner with the
  -- Empty trash action, then the caller's trashed roots with per-item Restore and Delete forever. Restore is a direct
  -- mutation; Delete forever and Empty trash both route through a destructive confirm. This route component owns the
  -- orchestration -- the store holds the listing and mutations, the child components render each piece.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section class="flex h-full flex-col gap-4">
        <header class="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div class="min-w-0">
                <h1 class="text-2xl font-bold">
                    Trash
                </h1>
                <p class="mt-1 text-sm text-muted">
                    Restore items to your files, or delete them forever.
                </p>
            </div>
            <ViewToggle class="shrink-0 self-end sm:self-auto" :view-mode="viewMode" @set-view="setView" />
        </header>

        <div
            class="flex shrink-0 flex-col items-start gap-3 rounded-lg border border-default px-4 py-3
                sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
            <p class="text-sm text-muted">
                Items in the trash are permanently deleted after {{ retentionLabel }}.
            </p>
            <UButton
                class="shrink-0"
                color="error"
                variant="soft"
                label="Empty trash"
                aria-label="Empty trash"
                :disabled="store.isEmpty"
                @click="emptyModal?.open()"
            />
        </div>

        <OffersSection />

        <FilterRow
            class="shrink-0"
            :type-families="store.typeFamilies"
            :modified="store.modified"
            :has-active-filters="store.hasActiveFilters"
            @update:types="onPickTypes"
            @update:modified="onPickModified"
            @clear="onClearFilters"
        />

        <TrashSurface class="min-h-0 flex-1" :view-mode="viewMode" @restore="onRestore" @delete="onDelete" />

        <DeleteForever ref="deleteModal" />
        <EmptyTrash ref="emptyModal" />
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';

    import type { NodeResponse, NodeTypeFamily, ViewMode } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../stores/session.ts';
    import { useTrashStore } from '../stores/trash.ts';

    // Components
    import ViewToggle from '../components/viewToggle.vue';
    import FilterRow from '../components/filters/filterRow.vue';
    import OffersSection from '../components/trash/offersSection.vue';
    import TrashSurface from '../components/trash/trashSurface.vue';
    import DeleteForever from '../components/trash/modals/deleteForever.vue';
    import EmptyTrash from '../components/trash/modals/emptyTrash.vue';

    // Utils
    import type { ModifiedFilter } from '../utils/filterPresets.ts';
    import { useRunWithToast } from '../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useTrashStore();
    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const retentionLabel = computed(() =>
    {
        const days = session.trashRetentionDays;
        return days === 1 ? '1 day' : `${ days } days`;
    });

    const deleteModal = ref<InstanceType<typeof DeleteForever> | null>(null);
    const emptyModal = ref<InstanceType<typeof EmptyTrash> | null>(null);

    function onRestore(node : NodeResponse) : void
    {
        void runMutation(() => store.restore(node.id));
    }

    function onDelete(node : NodeResponse) : void
    {
        deleteModal.value?.open(node);
    }

    onMounted(() => void store.load());

    //------------------------------------------------------------------------------------------------------------------
    // View toggle and filters -- the toggle rides the shared viewMode preference (how the user likes to see files, not
    // a per-page choice); the filters are per-page-visit and drive the trash store's server-side reload.
    //------------------------------------------------------------------------------------------------------------------

    const viewMode = computed(() => session.viewMode);

    function setView(mode : ViewMode) : void
    {
        if(mode === session.viewMode) { return; }

        session.applyPreferences({ viewMode: mode });
        void runMutation(() => session.savePreferences({ viewMode: mode }));
    }

    function onPickTypes(families : NodeTypeFamily[]) : void
    {
        void store.setTypeFamilies(families);
    }

    function onPickModified(next : ModifiedFilter | null) : void
    {
        void store.setModified(next);
    }

    function onClearFilters() : void
    {
        void store.clearFilters();
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
