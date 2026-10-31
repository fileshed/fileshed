<!----------------------------------------------------------------------------------------------------------------------
  -- Text Editor
  --
  -- Each setting that can change at runtime sits in its own Compartment, so changing one is a reconfigure rather than a
  -- teardown. An external model change (a reload) is written into the document without echoing, so binding the model
  -- both ways never loops.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        ref="host"
        class="h-full w-full overflow-hidden"
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

    import { Compartment, EditorState, type Extension, Prec } from '@codemirror/state';
    import { EditorView, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
    import { minimalSetup } from 'codemirror';
    import { markdown } from '@codemirror/lang-markdown';

    // Engines
    import type { EditorMode } from '../../../engines/intent/index.ts';
    import { resolveEditorTheme } from '../../../engines/editorTheme.ts';

    // Components
    import { editorChrome } from './chrome.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        modelValue : string;
        mode : EditorMode;
        readOnly : boolean;
        theme : string;
        gutter : boolean;
    }>();

    const emit = defineEmits<{
        'update:modelValue' : [ value : string ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const host = ref<HTMLElement | null>(null);
    let view : EditorView | null = null;

    const language = new Compartment();
    const editable = new Compartment();
    const themeCompartment = new Compartment();
    const gutterCompartment = new Compartment();

    function languageExtension(mode : EditorMode) : Extension
    {
        return mode === 'markdown' ? markdown() : [];
    }

    function editableState(readOnly : boolean) : Extension
    {
        return [ EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly) ];
    }

    function themeExtension(themeID : string) : Extension
    {
        return resolveEditorTheme(themeID).extension;
    }

    // Line numbers plus the active-line gutter, present only when the gutter preference is on. The app-native gutter
    // chrome outranks the theme's own gutter styling, so it wins wherever both paint it.
    function gutterExtension(enabled : boolean) : Extension
    {
        return enabled ? [ lineNumbers(), highlightActiveLineGutter() ] : [];
    }

    //------------------------------------------------------------------------------------------------------------------

    onMounted(() =>
    {
        if(host.value === null) { return; }

        view = new EditorView({
            doc: props.modelValue,
            parent: host.value,
            extensions: [
                minimalSetup,
                EditorView.lineWrapping,
                language.of(languageExtension(props.mode)),
                editable.of(editableState(props.readOnly)),
                gutterCompartment.of(gutterExtension(props.gutter)),
                themeCompartment.of(themeExtension(props.theme)),
                Prec.high(editorChrome()),
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

    //------------------------------------------------------------------------------------------------------------------

    // An external model change (a reload) is written into the document; a change that already matches the current
    // document -- the echo of the user's own edit -- is skipped, so the two-way binding never loops.
    watch(() => props.modelValue, (value) =>
    {
        if(view === null) { return; }

        const current = view.state.doc.toString();
        if(value !== current)
        {
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
        }
    });

    watch(() => props.mode, (mode) =>
    {
        view?.dispatch({ effects: language.reconfigure(languageExtension(mode)) });
    });

    watch(() => props.readOnly, (readOnly) =>
    {
        view?.dispatch({ effects: editable.reconfigure(editableState(readOnly)) });
    });

    watch(() => props.theme, (themeID) =>
    {
        view?.dispatch({ effects: themeCompartment.reconfigure(themeExtension(themeID)) });
    });

    watch(() => props.gutter, (enabled) =>
    {
        view?.dispatch({ effects: gutterCompartment.reconfigure(gutterExtension(enabled)) });
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
