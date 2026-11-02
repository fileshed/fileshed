//----------------------------------------------------------------------------------------------------------------------
// Markdown HTML Store
//
// Whether the open markdown file's HTML renders. The owner's own files always do; anyone else's do once they turn on
// the preference, or after choosing "Show HTML" for that file, which lasts until they leave it.
//----------------------------------------------------------------------------------------------------------------------

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

// Stores
import { useEditorStore } from './editor.ts';
import { useSessionStore } from './session.ts';

//----------------------------------------------------------------------------------------------------------------------

export const useMarkdownHTMLStore = defineStore('markdownHTML', () =>
{
    const editor = useEditorStore();
    const session = useSessionStore();

    // The file whose HTML the reader chose to see.
    const shownNodeID = ref<string | null>(null);

    const rendered = computed(() =>
    {
        const node = editor.node;
        if(node === null) { return false; }

        return node.role === 'owner' || session.showMarkdownHTML || shownNodeID.value === node.id;
    });

    function show() : void
    {
        shownNodeID.value = editor.node?.id ?? null;
    }

    function hide() : void
    {
        shownNodeID.value = null;
    }

    return {
        rendered,
        show,
        hide,
    };
});

//----------------------------------------------------------------------------------------------------------------------
