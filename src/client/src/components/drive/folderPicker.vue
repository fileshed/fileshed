<!----------------------------------------------------------------------------------------------------------------------
  -- Folder Picker
  --
  -- The destination browser inside the Move dialog: start at My Files, drill into folders, and confirm the current
  -- location as the move target. It only ever lists folders. The moving folder itself is not enterable and no location
  -- inside its own subtree can be confirmed (regulation.node), so an illegal move can't be expressed here -- the server
  -- still re-checks, but the picker won't waste a round trip on a move it already knows is impossible.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-1 text-sm">
            <UButton
                variant="link"
                color="neutral"
                size="sm"
                icon="i-lucide-hard-drive"
                :label="session.rootLabel"
                class="px-1"
                @click="goTo(-1)"
            />
            <template v-for="(folder, index) in path" :key="folder.id">
                <UIcon name="i-lucide-chevron-right" class="size-4 text-dimmed" />
                <UButton
                    variant="link"
                    :color="index === path.length - 1 ? 'primary' : 'neutral'"
                    size="sm"
                    :label="folder.name"
                    class="px-1"
                    @click="goTo(index)"
                />
            </template>
        </div>

        <div class="h-64 overflow-y-auto rounded-md border border-default">
            <div v-if="loading" class="flex h-full items-center justify-center text-sm text-muted">
                <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
            </div>

            <div v-else-if="error" class="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
                <span>Couldn't load folders.</span>
                <UButton size="xs" color="neutral" variant="subtle" label="Retry" @click="fetchFolders" />
            </div>

            <div
                v-else-if="folders.length === 0"
                class="flex h-full items-center justify-center text-sm text-dimmed"
            >
                No subfolders here.
            </div>

            <button
                v-for="folder in folders"
                v-else
                :key="folder.id"
                type="button"
                class="flex w-full items-center gap-2 border-b border-default px-3 py-2 text-left text-sm
                    last:border-b-0 enabled:hover:bg-elevated/50 disabled:opacity-40"
                :disabled="!regulation.node.canEnterFolderForMove(movingNodeIDs, folder.id)"
                @click="enter(folder)"
            >
                <UIcon name="i-lucide-folder" class="size-5 shrink-0 text-primary" />
                <span class="truncate">{{ folder.name }}</span>
                <UIcon name="i-lucide-chevron-right" class="ml-auto size-4 shrink-0 text-dimmed" />
            </button>
        </div>

        <div class="flex items-center justify-between gap-2">
            <p class="truncate text-xs text-muted">
                {{ verb }} into <span class="font-medium text-default">{{ currentLabel }}</span>
            </p>
            <div class="flex gap-2">
                <UButton color="neutral" variant="ghost" label="Cancel" :disabled="pending" @click="emit('cancel')" />
                <UButton
                    :label="`${ verb } here`"
                    :loading="pending"
                    :disabled="!canConfirm"
                    @click="emit('confirm', currentID)"
                />
            </div>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';

    import { MAX_CHILDREN_LIMIT, type NodeResponse } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Resource Access
    import { getChildren } from '../../resource-access/nodes.ts';

    // Engines
    import { regulation } from '../../engines/regulation/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = withDefaults(defineProps<{
        movingNodeIDs : string[];
        pending ?: boolean;

        // The verb the footer speaks -- "Move" for relocations, "Add" for link placement. The picker's mechanics
        // don't change with it.
        verb ?: string;
    }>(), { pending: false, verb: 'Move' });

    const emit = defineEmits<{
        confirm : [ destinationParentID : string | null ];
        cancel : [];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const path = ref<NodeResponse[]>([]);
    const folders = ref<NodeResponse[]>([]);
    const loading = ref(false);
    const error = ref(false);

    const session = useSessionStore();

    const currentFolder = computed(() => path.value[path.value.length - 1] ?? null);
    const currentID = computed(() => currentFolder.value?.id ?? null);
    const currentLabel = computed(() => currentFolder.value?.name ?? session.rootLabel);
    const pathIDs = computed(() => path.value.map((folder) => folder.id));
    const canConfirm = computed(() => regulation.node.canMoveAllInto(props.movingNodeIDs, pathIDs.value));

    //------------------------------------------------------------------------------------------------------------------

    async function fetchFolders() : Promise<void>
    {
        loading.value = true;
        error.value = false;

        try
        {
            const page = await getChildren(currentID.value, { limit: MAX_CHILDREN_LIMIT, sortKey: 'name' });
            folders.value = page.nodes.filter((node) => node.type === 'folder');
        }
        catch
        {
            error.value = true;
            folders.value = [];
        }
        finally
        {
            loading.value = false;
        }
    }

    async function enter(folder : NodeResponse) : Promise<void>
    {
        if(!regulation.node.canEnterFolderForMove(props.movingNodeIDs, folder.id)) { return; }

        path.value = [ ...path.value, folder ];
        await fetchFolders();
    }

    // Breadcrumb hop: -1 is My Files (root), any other index truncates the path to that folder.
    async function goTo(index : number) : Promise<void>
    {
        path.value = index < 0 ? [] : path.value.slice(0, index + 1);
        await fetchFolders();
    }

    onMounted(fetchFolders);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
