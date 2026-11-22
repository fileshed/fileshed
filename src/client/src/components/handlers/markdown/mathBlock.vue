<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Math Block
  --
  -- The source, `$$` lines included, shows while the cursor is in it, while KaTeX loads, and when it holds no LaTeX.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NodeViewWrapper class="md-math-block">
        <!-- eslint-disable vue/no-v-html -- KaTeX escapes the LaTeX it draws, and its trust option is off -->
        <div
            v-if="rendered !== null"
            contenteditable="false"
            class="overflow-x-auto py-2"
            :class="{ 'cursor-text': !store.readOnly }"
            @mousedown="moveCursorInto"
            v-html="rendered"
        />
        <!-- eslint-enable vue/no-v-html -->
        <pre v-show="rendered === null"><NodeViewContent as="code" /></pre>
    </NodeViewWrapper>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';

    // Components
    import { useCursorInside } from './editorCursor.ts';
    import { renderLatex } from './katex.ts';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';

    // Engines
    import { mathBlockLatex } from '../../../engines/markdown/math.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownMathBlock' });

    const props = defineProps(nodeViewProps);

    const store = useEditorStore();
    const { hasCursor, moveCursorInto } = useCursorInside(props);

    const latex = computed(() => mathBlockLatex(props.node.textContent));
    const rendered = computed(() =>
    {
        return hasCursor.value || latex.value === '' ? null : renderLatex(latex.value, true);
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
