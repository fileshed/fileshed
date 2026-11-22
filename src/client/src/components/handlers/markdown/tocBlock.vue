<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Table of Contents
  --
  -- The marker shows while the cursor is on it, and whenever it no longer reads as a marker.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NodeViewWrapper class="md-toc">
        <nav
            v-if="showsList"
            contenteditable="false"
            aria-label="Table of contents"
            class="rounded-md border border-muted px-4 py-2"
            :class="{ 'cursor-text': !store.readOnly }"
            @mousedown="moveCursorInto"
        >
            <p v-if="outline.length === 0" class="text-muted">
                No headings
            </p>
            <ul v-else class="list-none ps-0">
                <li v-for="entry in outline" :key="entry.pos" :class="INDENTS[entry.level - topLevel]">
                    <a href="#" @mousedown.prevent @click.prevent="jumpToBlock(editor, entry.pos)">{{ entry.text }}</a>
                </li>
            </ul>
        </nav>
        <div v-show="!showsList">
            <NodeViewContent as="p" />
        </div>
    </NodeViewWrapper>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

    import type { EditorEvents } from '@tiptap/core';
    import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';

    // Components
    import { jumpToBlock, useCursorInside } from './editorCursor.ts';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';

    // Engines
    import { type OutlineEntry, buildOutline } from '../../../engines/markdown/outline.ts';
    import { isTOCMarker } from '../../../engines/markdown/toc.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownTOCBlock' });

    const props = defineProps(nodeViewProps);

    // Margins, since the editor's list styling sets each item's padding.
    const INDENTS = [ 'ms-0', 'ms-4', 'ms-8', 'ms-12', 'ms-16', 'ms-20' ];

    const store = useEditorStore();
    const { hasCursor, moveCursorInto } = useCursorInside(props);

    const outline = ref<OutlineEntry[]>(buildOutline(props.editor.state.doc));
    const topLevel = computed(() => Math.min(...outline.value.map((entry) => entry.level)));
    const showsList = computed(() => !hasCursor.value && isTOCMarker(props.node.textContent));

    function onTransaction({ transaction } : EditorEvents['transaction']) : void
    {
        if(transaction.docChanged) { outline.value = buildOutline(props.editor.state.doc); }
    }

    onMounted(() => { props.editor.on('transaction', onTransaction); });
    onBeforeUnmount(() => { props.editor.off('transaction', onTransaction); });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
