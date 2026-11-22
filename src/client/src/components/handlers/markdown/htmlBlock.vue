<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown HTML Block
  --
  -- While the HTML renders, its source stays in the document, hidden, and shows while the cursor is in it. Clicking the
  -- rendered HTML puts the cursor there, unless the click is on a link.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NodeViewWrapper class="md-html-block">
        <!-- eslint-disable vue/no-v-html -- sanitizeHTML has removed scripts, styles and forms -->
        <div
            v-if="showsRendered"
            contenteditable="false"
            class="md-html-render"
            :class="{ 'cursor-text': !editorStore.readOnly }"
            @mousedown="moveCursorInto"
            v-html="sanitized.html"
        />
        <!-- eslint-enable vue/no-v-html -->
        <pre v-show="!showsRendered"><NodeViewContent as="code" /></pre>
    </NodeViewWrapper>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<style scoped>
    /* Rendered HTML is painted only inside this box, which is also what its fixed and absolute positions measure from,
       so nothing in it can be placed over the rest of the app. The minimum height keeps a box whose content is all
       positioned out of flow from collapsing to nothing. */
    .md-html-render {
        contain: paint;
        min-height: 1lh;
    }
</style>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';

    // Components
    import { useCursorInside } from './editorCursor.ts';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';
    import { useMarkdownHTMLStore } from '../../../stores/markdownHTML.ts';

    // Utils
    import { sanitizeHTML } from '../../../utils/sanitizeHTML.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownHTMLBlock' });

    const props = defineProps(nodeViewProps);

    const editorStore = useEditorStore();
    const html = useMarkdownHTMLStore();
    const { hasCursor, moveCursorInto } = useCursorInside(props);

    const sanitized = computed(() => sanitizeHTML(props.node.textContent));

    // HTML that draws nothing once sanitized shows its source instead, so it can't be deleted without being seen.
    const showsRendered = computed(() => html.rendered && sanitized.value.visible && !hasCursor.value);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
