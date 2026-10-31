<!----------------------------------------------------------------------------------------------------------------------
  -- Rename Title
  --
  -- A click opens the field with the name's stem selected, so retyping keeps the extension. It is prop-driven because
  -- each owner fronts a different store: the editor headers rename the file with it, the playlist panel its display
  -- title.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <span v-if="readOnly" class="truncate font-medium">{{ name }}</span>

    <input
        v-else-if="editing"
        ref="inputEl"
        v-model="draft"
        type="text"
        :aria-label="inputLabel"
        class="-mx-1.5 w-72 max-w-full rounded-md border border-accented bg-default px-1.5 py-0.5 font-medium
            outline-none focus:border-primary"
        @keydown.enter.prevent="commit"
        @keydown.esc.prevent="cancel"
        @blur="commit"
    >

    <button
        v-else
        type="button"
        :title="tooltip"
        class="-mx-1.5 min-w-0 cursor-text truncate rounded-md px-1.5 py-0.5 text-left font-medium
            ring-accented transition hover:ring"
        @click="beginEdit"
    >
        {{ name }}
    </button>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { nextTick, ref, useTemplateRef } from 'vue';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'RenameTitle' });

    const props = withDefaults(defineProps<{
        name : string;
        readOnly : boolean;
        rename : (name : string) => Promise<void>;
        tooltip ?: string;
        inputLabel ?: string;
    }>(), { tooltip: 'Rename', inputLabel: 'File name' });

    const { runMutation } = useRunWithToast();

    const editing = ref(false);
    const draft = ref('');
    const pending = ref(false);
    const inputEl = useTemplateRef<HTMLInputElement>('inputEl');

    async function beginEdit() : Promise<void>
    {
        draft.value = props.name;
        editing.value = true;
        await nextTick();

        const el = inputEl.value;
        if(!el) { return; }

        el.focus();
        const lastDot = draft.value.lastIndexOf('.');
        el.setSelectionRange(0, lastDot > 0 ? lastDot : draft.value.length);
    }

    function commit() : void
    {
        if(!editing.value) { return; }
        editing.value = false;

        const value = draft.value.trim();
        if(value.length === 0 || value === props.name) { return; }

        void runMutation(() => props.rename(value), pending);
    }

    function cancel() : void
    {
        editing.value = false;
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
