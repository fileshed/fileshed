<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Code Block
  --
  -- The header is outside the editable content, so ProseMirror never reads the picker as part of the code. A Mermaid
  -- block draws its diagram while the cursor is elsewhere, and shows its code with Mermaid's error when the code
  -- doesn't read as a diagram.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NodeViewWrapper class="md-code-block overflow-hidden rounded-md border border-muted bg-muted">
        <div contenteditable="false" class="flex justify-end border-b border-muted px-2 py-1">
            <USelectMenu
                v-if="!store.readOnly"
                :model-value="selectedOption"
                by="value"
                :items="options"
                :search-input="{ placeholder: 'Search languages' }"
                virtualize
                size="xs"
                variant="ghost"
                color="neutral"
                :ui="{ content: 'w-56' }"
                aria-label="Code language"
                @update:model-value="pick"
            />
            <span v-else class="px-2 py-0.5 text-xs text-muted">{{ selectedOption.label }}</span>
        </div>

        <!-- eslint-disable vue/no-v-html -- Mermaid draws at its strict security level, which sanitizes the diagram -->
        <div
            v-if="showsDiagram"
            contenteditable="false"
            class="flex justify-center overflow-x-auto bg-default p-4"
            :class="{ 'cursor-text': !store.readOnly }"
            @mousedown="moveCursorInto"
            v-html="diagram"
        />
        <!-- eslint-enable vue/no-v-html -->
        <p v-if="isMermaid && !hasCursor && diagramError" contenteditable="false" class="px-4 pt-2 text-xs text-error">
            {{ diagramError }}
        </p>
        <pre v-show="!showsDiagram"><NodeViewContent as="code" /></pre>
    </NodeViewWrapper>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<style scoped>
    /* The editor's prose styling frames every pre; here the frame is the wrapper, which also holds the header. */
    .md-code-block pre {
        margin: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
    }
</style>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';

    import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
    import { useDark } from '@vueuse/core';

    // Components
    import { useCursorInside } from './editorCursor.ts';
    import { renderMermaid } from './mermaid.ts';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';

    // Engines
    import {
        type CodeLanguageOption,
        codeLanguageOptions,
        fenceLanguageWord,
        withFenceLanguage,
    } from '../../../engines/markdown/codeLanguages.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownCodeBlock' });

    const props = defineProps(nodeViewProps);

    const PLAIN_TEXT : CodeLanguageOption = { label: 'Plain text', value: '' };

    const store = useEditorStore();

    const info = computed(() => props.node.attrs.language as string | null);
    const selected = computed(() => fenceLanguageWord(info.value));

    // A fence naming a language the picker doesn't list keeps that name as an option of its own, so the picker shows
    // what the file says rather than a blank.
    const options = computed<CodeLanguageOption[]>(() =>
    {
        const listed = selected.value === '' || codeLanguageOptions.some((option) => option.value === selected.value);
        return [
            PLAIN_TEXT,
            ...(listed ? [] : [ { label: selected.value, value: selected.value } ]),
            ...codeLanguageOptions,
        ];
    });

    // The menu holds whole options, compared by value: its items can't carry plain text's empty value on their own.
    const selectedOption = computed(() =>
        options.value.find((option) => option.value === selected.value) ?? PLAIN_TEXT);

    function pick(option : CodeLanguageOption) : void
    {
        if(option.value === selected.value) { return; }

        props.updateAttributes({ language: withFenceLanguage(info.value, option.value) });
    }

    //------------------------------------------------------------------------------------------------------------------
    // Mermaid
    //------------------------------------------------------------------------------------------------------------------

    const { hasCursor, moveCursorInto } = useCursorInside(props);
    const dark = useDark();

    const isMermaid = computed(() => selected.value === 'mermaid');
    const diagram = ref<string | null>(null);
    const diagramError = ref<string | null>(null);
    const showsDiagram = computed(() => isMermaid.value && !hasCursor.value && diagram.value !== null);

    // Drawn when the cursor leaves, not on every keystroke in the code. A slow draw finishing after a newer one has
    // started is dropped.
    let drawing = 0;
    watch([ isMermaid, hasCursor, () => props.node.textContent, dark ], async ([ mermaid, cursor, source, isDark ]) =>
    {
        if(!mermaid || cursor) { return; }

        drawing += 1;
        const draw = drawing;
        if(source.trim() === '')
        {
            diagram.value = null;
            diagramError.value = null;
            return;
        }

        try
        {
            const svg = await renderMermaid(source, isDark);
            if(draw !== drawing) { return; }

            diagram.value = svg;
            diagramError.value = null;
        }
        catch(error)
        {
            if(draw !== drawing) { return; }

            diagram.value = null;
            diagramError.value = error instanceof Error ? error.message : String(error);
        }
    }, { immediate: true });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
