<!----------------------------------------------------------------------------------------------------------------------
  -- Name Dialog
  --
  -- The shared name prompt behind New Folder and Rename: a single validated text field. The parent owns the action --
  -- this emits the entered name and stays open until the parent closes it, so a rejected mutation can surface its error
  -- without the dialog vanishing first. The field resets to `initial` each time the dialog opens.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="title" :dismissible="!pending">
        <template #body>
            <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
                <UFormField :label="label" name="name">
                    <UInput
                        v-model="state.name"
                        autofocus
                        class="w-full"
                        @keydown.enter.prevent="submitViaEnter"
                    />
                </UFormField>

                <div class="flex justify-end gap-2">
                    <UButton
                        type="button"
                        color="neutral"
                        variant="ghost"
                        label="Cancel"
                        :disabled="pending"
                        @click="open = false"
                    />
                    <UButton type="submit" :label="submitLabel" :loading="pending" />
                </div>
            </UForm>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { reactive, watch } from 'vue';
    import { z } from 'zod';
    import type { FormSubmitEvent } from '@nuxt/ui';

    //------------------------------------------------------------------------------------------------------------------

    const props = withDefaults(defineProps<{
        title : string;
        label : string;
        submitLabel : string;
        initial ?: string;
        pending ?: boolean;
    }>(), { initial: '', pending: false });

    const open = defineModel<boolean>('open', { required: true });

    const emit = defineEmits<{
        submit : [ name : string ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const schema = z.object({
        name: z.string().trim()
            .min(1, 'Enter a name.'),
    });

    type NameFields = z.output<typeof schema>;

    const state = reactive({ name: props.initial });

    watch(open, (isOpen) =>
    {
        if(isOpen) { state.name = props.initial; }
    });

    //------------------------------------------------------------------------------------------------------------------

    function onSubmit(event : FormSubmitEvent<NameFields>) : void
    {
        emit('submit', event.data.name);
    }

    // Enter inside the input submits without letting the keydown bubble to the row/tile underneath the modal.
    function submitViaEnter() : void
    {
        const name = state.name.trim();
        if(name.length > 0) { emit('submit', name); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
