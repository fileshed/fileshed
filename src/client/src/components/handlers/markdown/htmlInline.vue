<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown HTML Inline
  --
  -- One inline piece of HTML, edited in Source: rendered, or as its highlighted source while HTML isn't showing.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NodeViewWrapper as="span" contenteditable="false">
        <!-- eslint-disable-next-line vue/no-v-html -- sanitizeHTML has removed scripts, styles and forms -->
        <span v-if="showsRendered" class="md-html-render" v-html="sanitized.html" />
        <code v-else><span
            v-for="(piece, index) in pieces"
            :key="index"
            :class="piece.classes"
        >{{ piece.text }}</span></code>
    </NodeViewWrapper>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<style scoped>
    /* Rendered HTML is painted only inside this box, which is also what its fixed and absolute positions measure from,
       so nothing in it can be placed over the rest of the app. */
    .md-html-render {
        display: inline-block;
        max-width: 100%;
        contain: paint;
    }
</style>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, shallowRef, watch } from 'vue';

    import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';

    // Stores
    import { useMarkdownHTMLStore } from '../../../stores/markdownHTML.ts';

    // Engines
    import { type HighlightedPiece, highlightCode } from '../../../engines/markdown/codeHighlight.ts';

    // Utils
    import { sanitizeHTML } from '../../../utils/sanitizeHTML.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownHTMLInline' });

    const props = defineProps(nodeViewProps);

    const html = useMarkdownHTMLStore();

    const source = computed(() => props.node.attrs.source as string);
    const sanitized = computed(() => sanitizeHTML(source.value));

    // HTML that draws nothing once sanitized shows its source instead, so it can't be deleted without being seen.
    const showsRendered = computed(() => html.rendered && sanitized.value.visible);

    // Plain until the HTML grammar has loaded.
    const pieces = shallowRef<HighlightedPiece[]>([]);

    watch(source, async (code) =>
    {
        pieces.value = [ { text: code, classes: '' } ];

        const highlighted = await highlightCode(code, 'html');
        if(code === source.value) { pieces.value = highlighted; }
    }, { immediate: true });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
