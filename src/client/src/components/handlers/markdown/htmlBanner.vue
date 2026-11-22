<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown HTML Banner
  --
  -- Follows every transaction rather than every update, since a resync from Source changes the document without one.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UAlert
        v-if="hasHTML && !html.rendered"
        color="neutral"
        variant="subtle"
        icon="i-lucide-code-xml"
        title="This file contains HTML"
        description="It shows as source until you choose to see it rendered. Scripts are removed either way."
        orientation="horizontal"
        :actions="[ { label: 'Show HTML', color: 'neutral', variant: 'outline', onClick: html.show } ]"
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onBeforeUnmount, onMounted, shallowRef } from 'vue';

    import type { Editor, EditorEvents } from '@tiptap/core';
    import type { Node } from '@tiptap/pm/model';

    // Stores
    import { useMarkdownHTMLStore } from '../../../stores/markdownHTML.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownHTMLBanner' });

    const props = defineProps<{
        editor : Editor;
    }>();

    const HTML_NODES = [ 'htmlBlock', 'htmlInline' ];

    const html = useMarkdownHTMLStore();

    function containsHTML(doc : Node) : boolean
    {
        let found = false;
        doc.descendants((node) =>
        {
            found ||= HTML_NODES.includes(node.type.name);
            return !found;
        });

        return found;
    }

    const hasHTML = shallowRef(containsHTML(props.editor.state.doc));

    function onTransaction({ transaction } : EditorEvents['transaction']) : void
    {
        if(transaction.docChanged) { hasHTML.value = containsHTML(props.editor.state.doc); }
    }

    onMounted(() => { props.editor.on('transaction', onTransaction); });
    onBeforeUnmount(() => { props.editor.off('transaction', onTransaction); });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
