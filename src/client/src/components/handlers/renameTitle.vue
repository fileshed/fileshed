<!----------------------------------------------------------------------------------------------------------------------
  -- Rename Title
  --
  -- The file name in the editor header, and the Docs-style inline rename behind it: hover shows the click affordance,
  -- a click swaps in an edit field with the name's stem pre-selected (so retyping keeps the extension without any
  -- munging), Enter or blur commits through the owning store's rename, Escape cancels, and a blank or unchanged entry
  -- reverts silently. Read-only sessions get the plain name. Prop-driven like the save indicator, because each editor
  -- family fronts a different store.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <span v-if="readOnly" class="truncate font-medium">{{ name }}</span>

    <input
        v-else-if="editing"
        ref="inputEl"
        v-model="draft"
        type="text"
        aria-label="File name"
        class="-mx-1.5 w-72 max-w-full rounded-md border border-accented bg-default px-1.5 py-0.5 font-medium
            outline-none focus:border-primary"
        @keydown.enter.prevent="commit"
        @keydown.esc.prevent="cancel"
        @blur="commit"
    >

    <button
        v-else
        type="button"
        title="Rename"
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

    const props = defineProps<{
        name : string;
        readOnly : boolean;
        rename : (name : string) => Promise<void>;
    }>();

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
