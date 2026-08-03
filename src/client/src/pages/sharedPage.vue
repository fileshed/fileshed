<!----------------------------------------------------------------------------------------------------------------------
  -- Shared With Me Page
  --
  -- The virtual listing of everything shared with the caller: each active incoming grant, its target rendered like a
  -- drive row, with owner attribution and the caller's role. It is a read-only surface over items the caller does not
  -- own -- there is no move, trash, or rename here; the kebab offers only what a recipient may do (open, save a copy of
  -- a file, add a link to their own files, leave the share). Opening resolves the same way the drive does: a folder
  -- navigates in (the server's effective-role machinery permits the read), a file follows the handler seam. This route
  -- component owns the open action, the mutations, and the per-row menu; the store holds the listing and the surface
  -- renders it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section class="flex h-full flex-col gap-4">
        <header class="flex shrink-0 items-start justify-between gap-4">
            <div class="min-w-0">
                <h1 class="text-2xl font-bold">
                    Shared with me
                </h1>
                <p class="mt-1 text-sm text-muted">
                    Files and folders others have shared with you. Open them, save your own copy, or leave a share to
                    stop seeing it here.
                </p>
            </div>
            <ViewToggle :view-mode="viewMode" @set-view="setView" />
        </header>

        <FilterRow
            class="shrink-0"
            :type-families="store.typeFamilies"
            :modified="store.modified"
            :has-active-filters="store.hasActiveFilters"
            @update:types="onPickTypes"
            @update:modified="onPickModified"
            @clear="onClearFilters"
        />

        <SharedSurface class="min-h-0 flex-1" :view-mode="viewMode" :build-menu="buildMenu" @open="onOpen" />

        <AddToFilesModal ref="addToFilesModal" />
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';
    import type { DropdownMenuItem } from '@nuxt/ui';

    import type { NodeTypeFamily, SharedWithMeEntry, ViewMode } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../stores/session.ts';
    import { useSharedStore } from '../stores/shared.ts';

    // Components
    import ViewToggle from '../components/viewToggle.vue';
    import FilterRow from '../components/filters/filterRow.vue';
    import SharedSurface from '../components/shared/sharedSurface.vue';
    import AddToFilesModal from '../components/shared/modals/addToFiles.vue';

    // Engines
    import { intent } from '../engines/intent/index.ts';

    // Utils
    import type { ModifiedFilter } from '../utils/filterPresets.ts';
    import { useOpenNode } from '../utils/openNode.ts';
    import { useRunWithToast } from '../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useSharedStore();
    const session = useSessionStore();
    const toast = useToast();
    const { runMutation } = useRunWithToast();
    const { perform } = useOpenNode();

    const addToFilesModal = ref<InstanceType<typeof AddToFilesModal> | null>(null);

    onMounted(() => void store.load());

    //------------------------------------------------------------------------------------------------------------------
    // View toggle and filters -- the toggle rides the shared viewMode preference (how the user likes to see files, not
    // a per-page choice); the filters are per-page-visit and drive the shared store's server-side reload.
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

    //------------------------------------------------------------------------------------------------------------------
    // Open -- the same handler seam the drive uses. A shared folder navigates in place; every file surface opens in a
    // fresh tab -- the in-app editor (read-only for a viewer), the annotator, the players, and browser-renderable or
    // downloadable files off the download endpoint.
    //------------------------------------------------------------------------------------------------------------------

    function onOpen(entry : SharedWithMeEntry) : void
    {
        perform(intent.handlers.resolveSharedOpen(entry.target));
    }

    function openIcon(entry : SharedWithMeEntry) : string
    {
        switch (intent.handlers.resolveSharedOpen(entry.target).kind)
        {
            case 'navigate': return 'i-lucide-folder-open';
            case 'edit': return 'i-lucide-file-pen';
            case 'annotate': return 'i-lucide-pen-tool';
            case 'play': return 'i-lucide-play';
            case 'play-playlist': return 'i-lucide-list-music';
            case 'view': return 'i-lucide-external-link';
            case 'download': return 'i-lucide-download';
            case 'none': return 'i-lucide-external-link';
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Recipient mutations -- save a copy of a shared file, place a link to the target, or leave the share. Copy and
    // leave are direct mutations with a toast; add-to-files hands off to its own modal, which owns the destination pick
    // and toasts on confirm.
    //------------------------------------------------------------------------------------------------------------------

    function copy(entry : SharedWithMeEntry) : void
    {
        void runMutation(
            () => store.copy(entry.target.id),
            undefined,
            () => toast.add({
                title: 'Saved to your files',
                description: `"${ entry.target.name }" is now in My Files.`,
                color: 'success',
            })
        );
    }

    function addToFiles(entry : SharedWithMeEntry) : void
    {
        addToFilesModal.value?.open(entry.target);
    }

    function leave(entry : SharedWithMeEntry) : void
    {
        void runMutation(
            () => store.leave(entry.share.id),
            undefined,
            () => toast.add({
                title: 'Left the share',
                description: `You no longer have access to "${ entry.target.name }".`,
                color: 'info',
            })
        );
    }

    //------------------------------------------------------------------------------------------------------------------
    // Per-row menu -- recipient actions only. No move/trash/rename: those act on the ACL of a node you do not own. A
    // copy needs only read access, so it rides for any role; folders carry no bytes to copy. Add-to-files only makes
    // sense while unplaced -- once placed, a "Show in my files" jump would need the placed link's own id and parent,
    // which the wire entry doesn't carry (it exposes placement as a bare boolean), so a placed entry offers neither
    // action rather than a menu item with nowhere to go.
    //------------------------------------------------------------------------------------------------------------------

    function buildMenu(entry : SharedWithMeEntry) : DropdownMenuItem[][]
    {
        const actions : DropdownMenuItem[] = [
            { label: 'Open', icon: openIcon(entry), onSelect: () => onOpen(entry) },
        ];
        if(entry.target.type === 'file')
        {
            actions.push({ label: 'Save a copy', icon: 'i-lucide-copy', onSelect: () => copy(entry) });
        }
        if(!entry.placed)
        {
            actions.push({
                label: 'Add to my files',
                icon: 'i-lucide-folder-symlink',
                onSelect: () => addToFiles(entry),
            });
        }

        return [
            actions,
            [ { label: 'Leave share', icon: 'i-lucide-log-out', color: 'error', onSelect: () => leave(entry) } ],
        ];
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
