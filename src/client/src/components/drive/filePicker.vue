<!----------------------------------------------------------------------------------------------------------------------
  -- File Picker
  --
  -- `accept` follows the HTML accept attribute (an exact mime, a `type/*` family, or a `.ext` name suffix, which
  -- playlist files need because they travel under too many mimes to enumerate), plus a bare `*` for any file, since
  -- `*/*` would ask for a mime beginning with `*`. Links are omitted, because this picks concrete files.
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

            <div
                v-for="entry in entries"
                v-else
                :key="entry.id"
                class="flex items-center border-b border-default last:border-b-0"
            >
                <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm
                        enabled:hover:bg-elevated/50 disabled:opacity-40"
                    :disabled="entry.type === 'file' && !accepts(entry)"
                    @click="onEntry(entry)"
                >
                    <UIcon :name="iconFor(entry)" class="size-5 shrink-0" :class="colorFor(entry)" />
                    <span class="truncate">{{ entry.name }}</span>
                    <UIcon
                        v-if="pickedIDs?.has(entry.id)"
                        name="i-lucide-check"
                        aria-label="In playlist"
                        class="ml-auto size-4 shrink-0 text-primary"
                    />
                    <UIcon
                        v-else-if="entry.type === 'folder'"
                        name="i-lucide-chevron-right"
                        class="ml-auto size-4 shrink-0 text-dimmed"
                    />
                </button>

                <UButton
                    v-if="folderAddable && entry.type === 'folder'"
                    :icon="folderActionIcon"
                    :label="folderActionLabel"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                    class="mr-2 shrink-0"
                    :disabled="pending"
                    :aria-label="`${ folderActionLabel }: ${ entry.name }`"
                    @click="emit('select-folder', entry)"
                />
            </div>
        </div>

        <div class="flex items-center justify-between gap-2">
            <p class="truncate text-xs text-muted">
                {{ caption }}
            </p>
            <UButton color="neutral" variant="ghost" :label="cancelLabel" :disabled="pending" @click="emit('cancel')" />
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
    import { listChildren } from '../../resource-access/nodes.ts';

    // Utils
    import { nodePresentation } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = withDefaults(defineProps<{
        accept : readonly string[];
        pending ?: boolean;
        caption ?: string;
        cancelLabel ?: string;
        pickedIDs ?: ReadonlySet<string>;
        folderAddable ?: boolean;

        // What the folder-row button says and shows. Defaults to the playlist wording it was written for; a host
        // taking a folder as the thing itself, rather than as a bag of media, says so here.
        folderActionLabel ?: string;
        folderActionIcon ?: string;
    }>(), {
        pending: false,
        caption: 'Pick a file to continue.',
        cancelLabel: 'Cancel',
        pickedIDs: undefined,
        folderAddable: false,
        folderActionLabel: 'Add all',
        folderActionIcon: 'i-lucide-list-plus',
    });

    const emit = defineEmits<{
        'select' : [ node : NodeResponse ];
        'select-folder' : [ node : NodeResponse ];
        'cancel' : [];
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
        if(node.type !== 'file') { return false; }

        return props.accept.some((entry) =>
        {
            if(entry === '*') { return true; }
            if(entry.startsWith('.')) { return node.name.toLowerCase().endsWith(entry); }

            return entry.endsWith('/*') ? node.mimeType.startsWith(entry.slice(0, -1)) : node.mimeType === entry;
        });
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
            const page = await listChildren(currentID.value, { limit: MAX_CHILDREN_LIMIT, sortKey: 'name' });
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
