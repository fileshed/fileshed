<!----------------------------------------------------------------------------------------------------------------------
  -- CSS Editor
  --
  -- An external write to the model lands without emitting an update, so binding it both ways never loops.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div ref="host" class="overflow-hidden rounded-md border border-default" />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

    import { EditorView, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
    import { minimalSetup } from 'codemirror';
    import { css } from '@codemirror/lang-css';

    // Engines
    import { resolveEditorTheme } from '../../../engines/editorTheme.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        modelValue : string;
        theme : string;
    }>();

    const emit = defineEmits<{ 'update:modelValue' : [ value : string ] }>();

    const host = ref<HTMLElement | null>(null);
    let view : EditorView | null = null;

    onMounted(() =>
    {
        if(host.value === null) { return; }

        view = new EditorView({
            doc: props.modelValue,
            parent: host.value,
            extensions: [
                minimalSetup,
                EditorView.lineWrapping,
                EditorView.theme({ '&': { height: '14rem' }, '.cm-scroller': { overflow: 'auto' } }),
                lineNumbers(),
                highlightActiveLineGutter(),
                css(),
                resolveEditorTheme(props.theme).extension,
                EditorView.updateListener.of((update) =>
                {
                    if(update.docChanged) { emit('update:modelValue', update.state.doc.toString()); }
                }),
            ],
        });
    });

    onBeforeUnmount(() =>
    {
        view?.destroy();
        view = null;
    });

    watch(() => props.modelValue, (value) =>
    {
        if(view === null) { return; }

        const current = view.state.doc.toString();
        if(value !== current)
        {
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
        }
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
