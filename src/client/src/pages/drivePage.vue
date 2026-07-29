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
                :can-share="canShare"
                :can-move="canMove"
                :can-trash="canTrash"
                :trash-label="trashLabel"
                @clear="clearSel"
                @move="moveSelection"
                @copy="copySelected"
                @rename="renameSingle"
                @share="shareSingle"
                @trash="trashSelected"
            />
            <FilterBar v-else :view-mode="viewMode" />
        </div>

        <DropZone :label="currentFolderName" class="min-h-0 flex-1" @drop-upload="onDropUpload">
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
        <ShareDialog ref="shareModal" />
        <NewFolder />
        <NewDocument />
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { useToast } from '@nuxt/ui/composables';
    import type { ContextMenuItem } from '@nuxt/ui';

    import type { NodeResponse, NodeSortKey, ViewMode } from '@fileshed/core';

    // Stores
    import { useDriveStore } from '../stores/drive.ts';
    import { useSessionStore } from '../stores/session.ts';
    import { useUploadsStore } from '../stores/uploads.ts';

    // Resource Access
    import { downloadUrl } from '../resource-access/downloads.ts';
    import { takeLegacyViewMode } from '../resource-access/legacyViewMode.ts';

    // Components
    import DriveHeader from '../components/drive/driveHeader.vue';
    import SelectionBar from '../components/drive/selectionBar.vue';
    import FilterBar from '../components/drive/filterBar.vue';
    import NodeSurface from '../components/drive/nodeSurface.vue';
    import DropZone from '../components/uploads/dropZone.vue';
    import RenameNode from '../components/drive/modals/renameNode.vue';
    import MoveNodes from '../components/drive/modals/moveNodes.vue';
    import ShareDialog from '../components/share/modals/shareDialog.vue';
    import NewFolder from '../components/drive/modals/newFolder.vue';
    import NewDocument from '../components/drive/modals/newDocument.vue';

    // Types
    import type { DriveCrumb } from '../components/drive/linkCrumbCard/types.ts';

    // Engines
    import { type SelectionState, intent } from '../engines/intent/index.ts';

    // Utils
    import { isDeadLink } from '../utils/formatters/index.ts';
    import { ownerIDFor, resolveOwner } from '../utils/resolveOwner.ts';
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

    const selection = ref<SelectionState>(intent.selection.emptySelection());
    const renameModal = ref<InstanceType<typeof RenameNode> | null>(null);
    const moveModal = ref<InstanceType<typeof MoveNodes> | null>(null);
    const shareModal = ref<InstanceType<typeof ShareDialog> | null>(null);

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

    // A pre-migration browser may still hold the view mode in localStorage. Adopted only when the profile's own blob
    // carries none, so a value already in the blob always wins; the legacy key is cleared either way, since it is
    // consulted at most once.
    function migrateLegacyViewMode() : void
    {
        const legacy = takeLegacyViewMode();
        if(legacy === null || session.me === null || session.me.preferences.viewMode !== undefined) { return; }

        session.applyPreferences({ viewMode: legacy });
        void runMutation(() => session.savePreferences({ viewMode: legacy }));
    }

    onMounted(() =>
    {
        void store.load(routeFolderID());
        migrateLegacyViewMode();
        window.addEventListener('keydown', onKeydown);
    });

    onUnmounted(() => window.removeEventListener('keydown', onKeydown));

    //------------------------------------------------------------------------------------------------------------------
    // Breadcrumb and view mode
    //------------------------------------------------------------------------------------------------------------------

    // A foreign chain (a cold reload deep inside a shared subtree, walked up from ancestors the caller only sees by
    // grant) roots under Shared with me instead of My Files -- the sharer's own folder names in between still render,
    // as browsable context once correctly rooted, not as a leak into the caller's own tree.
    const crumbRoot = computed<DriveCrumb>(() =>
    {
        return store.breadcrumbForeign
            ? { label: 'Shared with me', icon: 'i-lucide-users', to: '/shared' }
            : { label: session.rootLabel, icon: 'i-lucide-hard-drive', to: '/' };
    });

    // A link crumb renders through the link slot (marker + hover card), carrying the link node and its target owner
    // resolved off the standing owner directory -- which retains the owner even after the user descends past the link.
    // Every other crumb is a plain navigable label.
    const crumbs = computed<DriveCrumb[]>(() => [
        crumbRoot.value,
        ...store.breadcrumb.map((node) : DriveCrumb =>
        {
            if(node.type === 'link')
            {
                return {
                    label: node.name,
                    slot: 'link',
                    link: { node, owner: resolveOwner(ownerIDFor(node), store.knownOwners) },
                };
            }

            return { label: node.name, to: `/folder/${ node.id }` };
        }),
    ]);

    // The open folder's name for the drop overlay -- the last breadcrumb crumb, or the files root at the top.
    const currentFolderName = computed(() => store.breadcrumb.at(-1)?.name ?? session.rootLabel);

    const viewMode = computed(() => session.viewMode);

    function onDropUpload(entries : FileSystemEntry[], files : File[]) : void
    {
        void uploads.enqueueDropped(entries, files, store.folderID);
    }

    function setView(mode : ViewMode) : void
    {
        if(mode === session.viewMode) { return; }

        session.applyPreferences({ viewMode: mode });
        void runMutation(() => session.savePreferences({ viewMode: mode }));
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

    // The caller's own id, gating every owner-only action below -- direct ownership (node.ownerID), never the
    // resolved `role`: a folder owner reads a contribution placed in their own folder as role 'owner' but does not
    // administer it, so role alone would offer Rename/Move/Trash the server refuses.
    const currentUserID = computed(() => session.me?.id ?? null);

    const canCopy = computed(() => intent.selection.canCopySelection(selectedNodes.value));
    const copyTooltip = computed(() =>
    {
        return canCopy.value ? 'Make a copy' : 'Folders can\'t be copied';
    });
    const canRename = computed(() =>
    {
        return single.value !== null && !isDeadLink(single.value) && intent.selection.isOwnedBy(
            single.value,
            currentUserID.value
        );
    });
    const canShare = computed(() =>
    {
        return single.value !== null && intent.selection.canShareNode(single.value, currentUserID.value);
    });
    const canMove = computed(() => intent.selection.ownsSelection(selectedNodes.value, currentUserID.value));
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

    function clearSel() : void
    {
        selection.value = intent.selection.clearSelection();
    }

    //------------------------------------------------------------------------------------------------------------------
    // Open -- the native-viewer seam decides; the view just runs the intent. Folders navigate in place; every file
    // surface opens in a fresh tab (the editors, the annotator, the players at /file/:id, and browser-renderable or
    // downloadable files straight off the download endpoint), so the drive stays put behind the opened file. A resolved
    // link follows its target under that rule.
    //------------------------------------------------------------------------------------------------------------------

    function onOpen(node : NodeResponse) : void
    {
        const action = intent.handlers.resolveOpen(node);
        switch (action.kind)
        {
            case 'navigate': void router.push(`/folder/${ action.folderID }`); break;
            case 'edit': window.open(`/file/${ action.nodeID }`, '_blank'); break;
            case 'annotate': window.open(`/file/${ action.nodeID }`, '_blank'); break;
            case 'play': window.open(`/file/${ action.nodeID }`, '_blank'); break;
            case 'play-playlist': window.open(`/file/${ action.nodeID }`, '_blank'); break;
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
            case 'annotate': return 'i-lucide-pen-tool';
            case 'play': return 'i-lucide-play';
            case 'play-playlist': return 'i-lucide-list-music';
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

    function openShare(node : NodeResponse) : void
    {
        shareModal.value?.open(node);
    }

    function moveSelection() : void
    {
        if(!canMove.value) { return; }

        openMove(selectedNodes.value);
    }

    function renameSingle() : void
    {
        if(canRename.value && single.value !== null) { openRename(single.value); }
    }

    function shareSingle() : void
    {
        if(canShare.value && single.value !== null) { openShare(single.value); }
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
        if(!canTrash.value) { return; }

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
    // Context menu -- gated by direct ownership (node.ownerID), never the resolved `role`, exactly like the selection
    // bar above. A dead link owned by someone else offers nothing: there is no target to open and no administering it.
    // A foreign file (a viewer or editor's own contribution, or a node reached through a traversed folder link) gets
    // Open plus Save a copy -- Copy asks only read access, so it rides for any role -- so a non-owner is never left
    // with a bare Open. Every owner-only action -- Share, Rename, Move, Trash/Remove -- disappears entirely for a node
    // the caller does not directly own.
    //------------------------------------------------------------------------------------------------------------------

    function buildMenu(node : NodeResponse) : ContextMenuItem[][]
    {
        const owned = intent.selection.isOwnedBy(node, currentUserID.value);

        if(isDeadLink(node))
        {
            if(!owned) { return []; }

            return [ [
                { label: 'Remove', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => removeLink(node) },
            ] ];
        }

        const groups : ContextMenuItem[][] = [
            [ { label: 'Open', icon: openIcon(node), onSelect: () => onOpen(node) } ],
        ];

        if(!owned)
        {
            if(intent.selection.canCopyNode(node))
            {
                groups.push([ { label: 'Save a copy', icon: 'i-lucide-copy', onSelect: () => copyFile(node) } ]);
            }

            return groups;
        }

        if(node.type !== 'link')
        {
            groups.push([ { label: 'Share', icon: 'i-lucide-user-plus', onSelect: () => openShare(node) } ]);
        }

        const edit : ContextMenuItem[] = [
            { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => openRename(node) },
            { label: 'Move', icon: 'i-lucide-folder-input', onSelect: () => openMove([ node ]) },
        ];
        if(intent.selection.canCopyNode(node))
        {
            edit.push({ label: 'Make a copy', icon: 'i-lucide-copy', onSelect: () => copyFile(node) });
        }
        groups.push(edit);

        const remove : ContextMenuItem = node.type === 'link'
            ? { label: 'Remove', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => removeLink(node) }
            : { label: 'Trash', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => trashOne(node) };
        groups.push([ remove ]);

        return groups;
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
