<!----------------------------------------------------------------------------------------------------------------------
  -- Delete Forever Modal
  --
  -- The destructive confirm behind Delete forever, opened imperatively by the trash page for one node. It names the
  -- node and warns the delete is permanent; a folder additionally warns its contents go with it. Stays open until the
  -- delete resolves, so a rejection can toast without the dialog vanishing under it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Delete forever" :dismissible="!pending">
        <template #body>
            <div class="space-y-4">
                <p>
                    Permanently delete
                    <span class="font-semibold">"{{ target?.name }}"</span>? This can't be undone.
                </p>
                <p v-if="target?.type === 'folder'" class="text-sm text-muted">
                    Everything inside it is deleted too.
                </p>

                <div class="flex justify-end gap-2">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        label="Cancel"
                        :disabled="pending"
                        @click="open = false"
                    />
                    <UButton
                        color="error"
                        label="Delete forever"
                        aria-label="Confirm delete forever"
                        :loading="pending"
                        @click="confirm"
                    />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    import type { NodeResponse } from '@fileshed/core';

    // Stores
    import { useTrashStore } from '../../../stores/trash.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useTrashStore();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<NodeResponse | null>(null);

    function openFor(node : NodeResponse) : void
    {
        target.value = node;
        open.value = true;
    }

    function confirm() : void
    {
        const node = target.value;
        if(!node) { return; }

        void runMutation(() => store.purge(node.id), pending, () => { open.value = false; });
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
