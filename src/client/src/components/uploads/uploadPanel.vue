<!----------------------------------------------------------------------------------------------------------------------
  -- Upload Panel
  --
  -- The floating card in the bottom-right that tracks the upload queue: a summary header that collapses the list, one
  -- row per item, and a dismiss that clears the finished ones. It lives in the layout, not the drive view, so an upload
  -- keeps running and reporting while the user navigates away. A failed upload also raises a toast, once, on top of its
  -- row -- the row is the durable record, the toast the nudge.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        v-if="uploads.hasItems"
        class="fixed bottom-4 right-4 z-40 w-80 overflow-hidden rounded-lg border border-default bg-default shadow-lg"
    >
        <div class="flex items-center justify-between gap-2 border-b border-default px-3 py-2">
            <span class="truncate text-sm font-medium">{{ summary }}</span>

            <div class="flex items-center gap-1">
                <UButton
                    :icon="collapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-label="collapsed ? 'Expand uploads' : 'Collapse uploads'"
                    @click="collapsed = !collapsed"
                />
                <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="Dismiss finished uploads"
                    @click="uploads.clearFinished"
                />
            </div>
        </div>

        <div v-if="!collapsed" class="max-h-80 divide-y divide-default overflow-y-auto px-3">
            <UploadRow
                v-for="item in uploads.items"
                :key="item.id"
                :item="item"
                @cancel="uploads.cancel"
                @retry="uploads.retry"
            />
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    // Stores
    import { useUploadsStore } from '../../stores/uploads.ts';

    // Components
    import UploadRow from './uploadRow.vue';

    //------------------------------------------------------------------------------------------------------------------

    const uploads = useUploadsStore();
    const toast = useToast();

    const collapsed = ref(false);

    const summary = computed(() =>
    {
        const active = uploads.activeCount;
        if(active > 0) { return `Uploading ${ active }…`; }

        const failed = uploads.items.filter((item) => item.status === 'error').length;
        if(failed > 0) { return `${ failed } upload${ failed === 1 ? '' : 's' } failed`; }

        const done = uploads.doneCount;
        return `${ done } upload${ done === 1 ? '' : 's' } complete`;
    });

    //------------------------------------------------------------------------------------------------------------------
    // A failed upload toasts once. The row carries the message regardless; the toast just surfaces it when the panel
    // may be collapsed or off-screen.
    //------------------------------------------------------------------------------------------------------------------

    const toasted = new Set<string>();

    watch(
        () => uploads.items.filter((item) => item.status === 'error').map((item) => item.id),
        (failedIDs) =>
        {
            for(const id of failedIDs.filter((candidate) => !toasted.has(candidate)))
            {
                toasted.add(id);

                const item = uploads.items.find((candidate) => candidate.id === id);
                toast.add({
                    title: 'Upload failed',
                    description: item?.error ?? 'Please try again.',
                    color: 'error',
                });
            }
        }
    );
</script>

<!--------------------------------------------------------------------------------------------------------------------->
