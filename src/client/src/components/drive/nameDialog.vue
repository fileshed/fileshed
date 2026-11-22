<!----------------------------------------------------------------------------------------------------------------------
  -- Name Dialog
  --
  -- It stays open until the parent closes it, so a rejected mutation can show its error without the dialog vanishing
  -- first.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="title" :dismissible="!pending" :content="content">
        <template #body>
            <UForm :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
                <UFormField :label="label" name="name">
                    <UInput
                        ref="nameInput"
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
    import { computed, reactive, useTemplateRef, watch } from 'vue';
    import { z } from 'zod';
    import type { FormSubmitEvent } from '@nuxt/ui';

    //------------------------------------------------------------------------------------------------------------------

    const props = withDefaults(defineProps<{
        title : string;
        label : string;
        submitLabel : string;
        initial ?: string;
        pending ?: boolean;
        excludeExtension ?: boolean;
    }>(), { initial: '', pending: false, excludeExtension: false });

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

    const nameInput = useTemplateRef<{ inputRef : HTMLInputElement | null }>('nameInput');

    // The modal selects the whole field as it opens. With excludeExtension the selection stops before the extension
    // instead, so retyping keeps it; a leading dot names a dotfile rather than starting one.
    function selectStem(event : Event) : void
    {
        const input = nameInput.value?.inputRef;
        if(!input) { return; }

        event.preventDefault();
        input.focus();

        const dot = state.name.lastIndexOf('.');
        input.setSelectionRange(0, dot > 0 ? dot : state.name.length);
    }

    const content = computed(() => { return props.excludeExtension ? { onOpenAutoFocus: selectStem } : {}; });

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
