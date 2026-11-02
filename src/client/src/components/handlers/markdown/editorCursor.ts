//----------------------------------------------------------------------------------------------------------------------
// Editor Cursor Binding
//
// For node views that draw something in place of their source and show the source while the cursor is in them.
//----------------------------------------------------------------------------------------------------------------------

import { type Ref, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Editor, NodeViewProps } from '@tiptap/core';

// Stores
import { useEditorStore } from '../../../stores/editor.ts';

//----------------------------------------------------------------------------------------------------------------------

export interface CursorInside
{
    hasCursor : Ref<boolean>;

    // For a mousedown on what is drawn in the source's place: puts the cursor at the start of the source. A click on a
    // link, or in a read-only document, is left alone.
    moveCursorInto : (event : MouseEvent) => void;
}

export function useCursorInside(props : Pick<NodeViewProps, 'editor' | 'getPos' | 'node'>) : CursorInside
{
    const store = useEditorStore();
    const hasCursor = ref(false);

    function onTransaction() : void
    {
        const pos = props.getPos();
        const { from, to } = props.editor.state.selection;

        hasCursor.value = pos !== undefined && from > pos && to < pos + props.node.nodeSize;
    }

    onMounted(() =>
    {
        props.editor.on('transaction', onTransaction);
        onTransaction();
    });
    onBeforeUnmount(() => { props.editor.off('transaction', onTransaction); });

    function moveCursorInto(event : MouseEvent) : void
    {
        const pos = props.getPos();
        const onLink = event.target instanceof Element && event.target.closest('a') !== null;
        if(store.readOnly || pos === undefined || onLink) { return; }

        event.preventDefault();
        props.editor.chain().focus()
            .setTextSelection(pos + 1)
            .run();
    }

    return { hasCursor, moveCursorInto };
}

// The caret lands at the start of the block, and the block scrolls to the top of the page rather than just into view.
export function jumpToBlock(editor : Editor, pos : number) : void
{
    editor.chain().focus(pos + 1, { scrollIntoView: false })
        .run();

    const block = editor.view.nodeDOM(pos);
    if(block instanceof HTMLElement) { block.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

//----------------------------------------------------------------------------------------------------------------------
