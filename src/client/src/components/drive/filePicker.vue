<!----------------------------------------------------------------------------------------------------------------------
  -- File Picker
  --
  -- A read-only browse-and-pick over the caller's own drive: drill into folders, pick a single file. Folders are always
  -- navigable; files are selectable only when their mime type is in the `accept` list, so a caller (the avatar editor)
  -- can constrain the pick to images without re-implementing the navigation. Selecting a file emits it; the host
  -- decides what to do with it. Links are omitted -- this picks concrete files, not indirections.
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
                <span>Couldn't load files.</span>
                <UButton size="xs" color="neutral" variant="subtle" label="Retry" @click="fetchEntries" />
            </div>

            <div
                v-else-if="entries.length === 0"
                class="flex h-full items-center justify-center text-sm text-dimmed"
            >
                Nothing here.
            </div>

            <button
                v-for="entry in entries"
                v-else
                :key="entry.id"
                type="button"
                class="flex w-full items-center gap-2 border-b border-default px-3 py-2 text-left text-sm
                    last:border-b-0 enabled:hover:bg-elevated/50 disabled:opacity-40"
                :disabled="entry.type === 'file' && !accepts(entry)"
                @click="onEntry(entry)"
            >
                <UIcon :name="iconFor(entry)" class="size-5 shrink-0" :class="colorFor(entry)" />
                <span class="truncate">{{ entry.name }}</span>
                <UIcon
                    v-if="entry.type === 'folder'"
                    name="i-lucide-chevron-right"
                    class="ml-auto size-4 shrink-0 text-dimmed"
                />
            </button>
        </div>

        <div class="flex items-center justify-between gap-2">
            <p class="truncate text-xs text-muted">
                Pick a file to continue.
            </p>
            <UButton color="neutral" variant="ghost" label="Cancel" :disabled="pending" @click="emit('cancel')" />
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

    // Utils
    import { nodePresentation } from '../../utils/nodeTypePresentation.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = withDefaults(defineProps<{
        accept : readonly string[];
        pending ?: boolean;
    }>(), { pending: false });

    const emit = defineEmits<{
        select : [ node : NodeResponse ];
        cancel : [];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const path = ref<NodeResponse[]>([]);
    const nodes = ref<NodeResponse[]>([]);
    const loading = ref(false);
    const error = ref(false);

    const session = useSessionStore();

    const currentID = computed(() => path.value[path.value.length - 1]?.id ?? null);

    // Folders first, then files -- the server sorts by name across both, so a folders-first pass makes the picker read
    // the way a file manager does. Links conduct no bytes, so they never appear.
    const entries = computed(() =>
    {
        const folders = nodes.value.filter((node) => node.type === 'folder');
        const files = nodes.value.filter((node) => node.type === 'file');

        return [ ...folders, ...files ];
    });

    function accepts(node : NodeResponse) : boolean
    {
        return node.type === 'file' && props.accept.includes(node.mimeType);
    }

    function iconFor(node : NodeResponse) : string
    {
        return nodePresentation(node).icon;
    }

    function colorFor(node : NodeResponse) : string
    {
        return nodePresentation(node).color;
    }

    //------------------------------------------------------------------------------------------------------------------

    async function fetchEntries() : Promise<void>
    {
        loading.value = true;
        error.value = false;

        try
        {
            const page = await getChildren(currentID.value, { limit: MAX_CHILDREN_LIMIT, sortKey: 'name' });
            nodes.value = page.nodes;
        }
        catch
        {
            error.value = true;
            nodes.value = [];
        }
        finally
        {
            loading.value = false;
        }
    }

    async function onEntry(node : NodeResponse) : Promise<void>
    {
        if(node.type === 'folder')
        {
            path.value = [ ...path.value, node ];
            await fetchEntries();
            return;
        }

        if(accepts(node)) { emit('select', node); }
    }

    // Breadcrumb hop: -1 is the root, any other index truncates the path to that folder.
    async function goTo(index : number) : Promise<void>
    {
        path.value = index < 0 ? [] : path.value.slice(0, index + 1);
        await fetchEntries();
    }

    onMounted(fetchEntries);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
