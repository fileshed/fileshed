<!----------------------------------------------------------------------------------------------------------------------
  -- Empty Trash Modal
  --
  -- The destructive confirm behind "Empty trash", opened imperatively by the trash page. Unlike Delete forever it
  -- names no single node -- the whole trash goes at once. Stays open until the mutation resolves, so a rejection can
  -- toast without the dialog vanishing under it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Empty trash" :dismissible="!pending">
        <template #body>
            <div class="space-y-4">
                <p>
                    Permanently delete all items in the trash? This can't be undone.
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
                        label="Empty trash"
                        aria-label="Confirm empty trash"
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
    import { useToast } from '@nuxt/ui/composables';

    // Stores
    import { useTrashStore } from '../../../stores/trash.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const store = useTrashStore();
    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);

    function show() : void
    {
        open.value = true;
    }

    function confirm() : void
    {
        void runMutation(() => store.emptyAll(), pending, () =>
        {
            open.value = false;
            toast.add({
                title: 'Trash emptied',
                description: 'Everything in the trash was permanently deleted.',
                color: 'success',
            });
        });
    }

    defineExpose({ open: show });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
