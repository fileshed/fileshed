<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Inline Math
  --
  -- Drawn in place of a piece of inline math's source, which sits hidden right after it. A click puts the cursor in the
  -- source, which shows it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <span
        contenteditable="false"
        class="md-inline-math"
        :class="{ 'cursor-text': !store.readOnly }"
        @mousedown="openSource"
    >
        <!-- eslint-disable vue/no-v-html -- KaTeX escapes the LaTeX it draws, and its trust option is off -->
        <span v-if="rendered !== null" v-html="rendered" />
        <!-- eslint-enable vue/no-v-html -->
        <code v-else>{{ latex }}</code>
    </span>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { Editor } from '@tiptap/core';

    // Components
    import { renderLatex } from './katex.ts';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownInlineMath' });

    const props = defineProps<{
        editor : Editor;
        getPos : () => number | undefined;
        latex : string;
    }>();

    const store = useEditorStore();

    const rendered = computed(() => renderLatex(props.latex, false));

    function openSource(event : MouseEvent) : void
    {
        const pos = props.getPos();
        if(store.readOnly || pos === undefined) { return; }

        event.preventDefault();
        props.editor.chain().focus()
            .setTextSelection(pos + 1)
            .run();
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
