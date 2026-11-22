<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Word Count
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <p class="text-xs text-muted">
        {{ label }}
    </p>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue';

    import type { Editor, EditorEvents } from '@tiptap/core';

    // Engines
    import { countWords } from '../../../engines/wordCount.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownWordCount' });

    const props = defineProps<{
        editor : Editor;
        lang : string | null;
    }>();

    // Blocks are joined with a space, so the last word of one paragraph and the first of the next stay two words.
    function textBetween(from : number, to : number) : string
    {
        return props.editor.state.doc.textBetween(from, to, ' ', ' ');
    }

    function documentText() : string
    {
        return textBetween(0, props.editor.state.doc.content.size);
    }

    function selectionText() : string | null
    {
        const { from, to, empty } = props.editor.state.selection;

        return empty ? null : textBetween(from, to);
    }

    const docText = shallowRef(documentText());
    const selectedText = shallowRef(selectionText());

    // Counted apart, so moving the selection doesn't recount the whole document.
    const documentWords = computed(() => countWords(docText.value, props.lang ?? undefined));
    const selectedWords = computed(() =>
    {
        return selectedText.value === null ? null : countWords(selectedText.value, props.lang ?? undefined);
    });

    const label = computed(() =>
    {
        const words = documentWords.value;
        const total = `${ words.toLocaleString() } ${ words === 1 ? 'word' : 'words' }`;

        return selectedWords.value === null ? total : `${ selectedWords.value.toLocaleString() } of ${ total }`;
    });

    function onTransaction({ transaction } : EditorEvents['transaction']) : void
    {
        if(transaction.docChanged) { docText.value = documentText(); }
        selectedText.value = selectionText();
    }

    onMounted(() => { props.editor.on('transaction', onTransaction); });
    onBeforeUnmount(() => { props.editor.off('transaction', onTransaction); });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
