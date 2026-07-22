<!----------------------------------------------------------------------------------------------------------------------
  -- Upload Collision Modal
  --
  -- The prompt shown when an upload's name already exists in the target folder. It reads the head of the upload store's
  -- prompt queue, so exactly one collision is asked about at a time; the rest wait behind it. Keep both uploads under a
  -- numbered name, Replace overwrites the existing file, Cancel drops just this upload. Dismissing the dialog (escape or
  -- backdrop) reads as Cancel.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal :open="open" title="File already exists" @update:open="onOpenChange">
        <template #body>
            <p class="text-sm text-default">
                <span class="font-medium">{{ prompt?.name }}</span> already exists in this folder.
            </p>

            <div class="mt-4 flex justify-end gap-2">
                <UButton color="neutral" variant="ghost" label="Cancel" @click="choose('cancel')" />
                <UButton color="neutral" variant="subtle" label="Keep both" @click="choose('keep-both')" />
                <UButton color="primary" label="Replace" @click="choose('replace')" />
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { type CollisionChoice, useUploadsStore } from '../../../stores/uploads.ts';

    //------------------------------------------------------------------------------------------------------------------

    const uploads = useUploadsStore();

    const prompt = computed(() => uploads.currentPrompt);
    const open = computed(() => prompt.value !== null);

    function choose(choice : CollisionChoice) : void
    {
        uploads.resolveCollision(choice);
    }

    // A dismiss settles the current prompt as Cancel; a choice-driven close has already advanced the queue, so the
    // head is gone and this no-ops.
    function onOpenChange(value : boolean) : void
    {
        if(!value) { uploads.resolveCollision('cancel'); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
