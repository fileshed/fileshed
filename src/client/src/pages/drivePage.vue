<!----------------------------------------------------------------------------------------------------------------------
  -- Drive Page
  --
  -- The heart of the UI: My Files and every folder under it. A two-row header sits over the node surface -- the header
  -- row is constant (breadcrumb trail and the view toggle), and beneath it a constant-HEIGHT strip swaps between the
  -- idle controls and the selection bar, so the listing never reflows under a click. This route component owns the
  -- selection, the open action, and the context menu; the store owns the data and the mutations, and the child
  -- components render each piece. Navigation is deep-linkable: `/` is the root, `/folder/:id` a folder, both this view.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section class="flex h-full flex-col gap-1">
        <DriveHeader :crumbs="crumbs" :view-mode="viewMode" @set-view="setView" />

        <!-- Constant-height strip: the selection bar and the filter bar swap INSIDE it, so the listing below never
          -- reflows -- a surface that shifts mid-gesture breaks double-click (the first click's target moves out from
          -- under the second). -->
        <div class="flex h-12 shrink-0 items-center">
            <SelectionBar
                v-if="selectedNodes.length > 0"
                :count="selectedNodes.length"
                :can-copy="canCopy"
                :copy-tooltip="copyTooltip"
                :can-rename="canRename"
                :trash-label="trashLabel"
                @clear="clearSel"
                @move="moveSelection"
                @copy="copySelected"
                @rename="renameSingle"
                @trash="trashSelected"
            />
            <FilterBar v-else :view-mode="viewMode" />
        </div>

        <DropZone :label="currentFolderName" class="min-h-0 flex-1" @drop-files="onDropFiles">
            <NodeSurface
                :view-mode="viewMode"
                :selection="selection.selected"
                :build-menu="buildMenu"
                @select="onSelect"
                @open="onOpen"
                @sort="onSort"
                @clear-empty="clearSel"
            />
        </DropZone>

        <RenameNode ref="renameModal" />
        <MoveNodes ref="moveModal" />
        <NewFolder />
        <NewDocument />
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { useToast } from '@nuxt/ui/composables';
    import type { BreadcrumbItem, ContextMenuItem } from '@nuxt/ui';

    import type { NodeResponse, NodeSortKey } from '@fileshed/core';

    // Stores
    import { useDriveStore } from '../stores/drive.ts';
    import { useSessionStore } from '../stores/session.ts';
    import { useUploadsStore } from '../stores/uploads.ts';

    // Resource Access
    import { downloadUrl } from '../resource-access/downloads.ts';
    import { type ViewMode, loadViewMode, saveViewMode } from '../resource-access/viewPreference.ts';

    // Components
    import DriveHeader from '../components/drive/driveHeader.vue';
    import SelectionBar from '../components/drive/selectionBar.vue';
    import FilterBar from '../components/drive/filterBar.vue';
    import NodeSurface from '../components/drive/nodeSurface.vue';
    import DropZone from '../components/uploads/dropZone.vue';
    import RenameNode from '../components/drive/modals/renameNode.vue';
    import MoveNodes from '../components/drive/modals/moveNodes.vue';
    import NewFolder from '../components/drive/modals/newFolder.vue';
    import NewDocument from '../components/drive/modals/newDocument.vue';

    // Engines
    import { type SelectionState, intent } from '../engines/intent/index.ts';

    // Utils
    import { isDeadLink } from '../utils/nodeTypePresentation.ts';
    import { useRunWithToast } from '../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Setup
    //------------------------------------------------------------------------------------------------------------------

    const store = useDriveStore();
    const session = useSessionStore();
    const uploads = useUploadsStore();
    const route = useRoute();
    const router = useRouter();
    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const viewMode = ref<ViewMode>(loadViewMode());
    const selection = ref<SelectionState>(intent.selection.emptySelection());
    const renameModal = ref<InstanceType<typeof RenameNode> | null>(null);
    const moveModal = ref<InstanceType<typeof MoveNodes> | null>(null);

    //------------------------------------------------------------------------------------------------------------------
    // Routing -- the route param is the source of truth for which folder is open.
    //------------------------------------------------------------------------------------------------------------------

    function routeFolderID() : string | null
    {
        const { id } = route.params;
        return typeof id === 'string' && id.length > 0 ? id : null;
    }

    watch(() => route.params.id, () =>
    {
        selection.value = intent.selection.emptySelection();
        void store.load(routeFolderID());
    });

    // Trim selection to what's actually present after any listing change (navigation, refresh, load-more).
    watch(() => store.children, () =>
    {
        selection.value = intent.selection.reconcile(selection.value, store.children.map((node) => node.id));
    });

    function onKeydown(event : KeyboardEvent) : void
    {
        if(event.key === 'Escape') { selection.value = intent.selection.clearSelection(); }
    }

    onMounted(() =>
    {
        void store.load(routeFolderID());
        window.addEventListener('keydown', onKeydown);
    });

    onUnmounted(() => window.removeEventListener('keydown', onKeydown));

    //------------------------------------------------------------------------------------------------------------------
    // Breadcrumb and view mode
    //------------------------------------------------------------------------------------------------------------------

    const crumbs = computed<BreadcrumbItem[]>(() => [
        { label: session.rootLabel, icon: 'i-lucide-hard-drive', to: '/' },
        ...store.breadcrumb.map((folder) => ({ label: folder.name, to: `/folder/${ folder.id }` })),
    ]);

    // The open folder's name for the drop overlay -- the last breadcrumb crumb, or the files root at the top.
    const currentFolderName = computed(() => store.breadcrumb.at(-1)?.name ?? session.rootLabel);

    function onDropFiles(files : File[]) : void
    {
        uploads.enqueue(files, store.folderID);
    }

    function setView(mode : ViewMode) : void
    {
        viewMode.value = mode;
        saveViewMode(mode);
    }

    function onSort(key : NodeSortKey) : void
    {
        const direction = key === store.sortKey && store.sortDirection === 'asc' ? 'desc' : 'asc';
        void store.reSort(key, direction);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Selection
    //------------------------------------------------------------------------------------------------------------------

    const orderedIDs = computed(() => store.children.map((node) => node.id));

    const selectedNodes = computed(() => store.children.filter((node) => selection.value.selected.has(node.id)));
    const single = computed(() =>
    {
        return selectedNodes.value.length === 1 ? selectedNodes.value[0] ?? null : null;
    });

    const canCopy = computed(() => intent.selection.canCopySelection(selectedNodes.value));
    const copyTooltip = computed(() =>
    {
        return canCopy.value ? 'Make a copy' : 'Folders can\'t be copied';
    });
    const canRename = computed(() => single.value !== null && !isDeadLink(single.value));
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

    function clearSel() : void
    {
        selection.value = intent.selection.clearSelection();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Open -- the native-viewer seam decides; the view just runs the intent. Folders navigate, a browser-renderable
    // file opens inline in a new tab, anything else downloads, and a resolved link follows its target under that rule.
    //------------------------------------------------------------------------------------------------------------------

    function onOpen(node : NodeResponse) : void
    {
        const action = intent.handlers.resolveOpen(node);
        switch (action.kind)
        {
            case 'navigate': void router.push(`/folder/${ action.folderID }`); break;
            case 'edit': void router.push(`/file/${ action.nodeID }`); break;
            case 'view': window.open(downloadUrl(action.nodeID, 'inline'), '_blank'); break;
            case 'download': window.open(downloadUrl(action.nodeID), '_blank'); break;
            case 'none': break;
        }
    }

    function openIcon(node : NodeResponse) : string
    {
        switch (intent.handlers.resolveOpen(node).kind)
        {
            case 'navigate': return 'i-lucide-folder-open';
            case 'edit': return 'i-lucide-file-pen';
            case 'view': return 'i-lucide-external-link';
            case 'download': return 'i-lucide-download';
            case 'none': return 'i-lucide-external-link';
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Rename and Move open their own modals imperatively -- both the selection bar and the context menu funnel through
    // openRename / openMove.
    //------------------------------------------------------------------------------------------------------------------

    function openRename(node : NodeResponse) : void
    {
        renameModal.value?.open(node);
    }

    function openMove(nodes : NodeResponse[]) : void
    {
        moveModal.value?.open(nodes);
    }

    function moveSelection() : void
    {
        openMove(selectedNodes.value);
    }

    function renameSingle() : void
    {
        if(single.value !== null) { openRename(single.value); }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Copy and Trash -- direct mutations, each failure a toast.
    //------------------------------------------------------------------------------------------------------------------

    function copyFile(node : NodeResponse) : void
    {
        void runMutation(() => store.copy(node.id));
    }

    // The selection bar's Copy: only reachable when every selected node is a file, each copied into the current folder.
    function copySelected() : void
    {
        if(!canCopy.value) { return; }

        const targets = selectedNodes.value.map((node) => node.id);
        void runMutation(async () =>
        {
            for(const id of targets)
            {
                // eslint-disable-next-line no-await-in-loop
                await store.copy(id);
            }
        });
    }

    // The selection bar's Trash/Remove. A links-only selection is removed; otherwise files and folders are trashed and
    // any links are reported as left in place -- links are never trashable, and Remove is irreversible.
    function trashSelected() : void
    {
        const plan = intent.selection.planTrash(selectedNodes.value);
        const targets = [ ...plan.targetIDs ];
        if(targets.length === 0) { return; }

        void runMutation(
            async () =>
            {
                for(const id of targets)
                {
                    // eslint-disable-next-line no-await-in-loop
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
                            + 'Remove links from their own menu.',
                        color: 'info',
                    });
                }
            }
        );
    }

    function trashOne(node : NodeResponse) : void
    {
        void runMutation(() => store.trash(node.id));
    }

    function removeLink(node : NodeResponse) : void
    {
        void runMutation(() => store.removeDeadLink(node.id));
    }

    //------------------------------------------------------------------------------------------------------------------
    // Context menu -- a dead link offers only Remove; every other node gets the full set, with Trash for files and
    // folders and Remove for links (links are deleted directly, never trashed).
    //------------------------------------------------------------------------------------------------------------------

    function buildMenu(node : NodeResponse) : ContextMenuItem[][]
    {
        if(isDeadLink(node))
        {
            return [ [
                { label: 'Remove', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => removeLink(node) },
            ] ];
        }

        const edit : ContextMenuItem[] = [
            { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => openRename(node) },
            { label: 'Move', icon: 'i-lucide-folder-input', onSelect: () => openMove([ node ]) },
        ];
        if(node.type === 'file')
        {
            edit.push({ label: 'Make a copy', icon: 'i-lucide-copy', onSelect: () => copyFile(node) });
        }

        const remove : ContextMenuItem = node.type === 'link'
            ? { label: 'Remove', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => removeLink(node) }
            : { label: 'Trash', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => trashOne(node) };

        return [
            [ { label: 'Open', icon: openIcon(node), onSelect: () => onOpen(node) } ],
            edit,
            [ remove ],
        ];
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
