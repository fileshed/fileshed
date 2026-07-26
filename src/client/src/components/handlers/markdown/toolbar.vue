<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Formatting Toolbar
  --
  -- The word-processor toolbar: a fixed row of grouped formatting controls pinned above the document canvas, shown only
  -- in WYSIWYG mode. It rides Nuxt UI's UEditorToolbar (layout="fixed"), which resolves each item's kind against the
  -- editor's handler registry -- so it must mount inside the UEditor slot to inject the custom handlers (table, indent,
  -- outdent) the mount component layers on. Active states track the block/marks at the cursor; the paragraph-style
  -- control is a single dropdown whose label reflects the current block, never a row of heading buttons. Every control
  -- carries an aria-label. Only honestly-serializable structures are offered, matching the GFM round-trip guarantee.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UEditorToolbar
        :editor="editor"
        layout="fixed"
        :items="items"
        class="flex-wrap"
    />
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { Editor } from '@tiptap/vue-3';
    import type { EditorToolbarItem } from '@nuxt/ui/components/EditorToolbar.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownFormatToolbar' });

    defineProps<{
        editor : Editor;
    }>();

    type MarkName = 'bold' | 'italic' | 'strike' | 'code';

    // An icon control tied to a handler kind, carrying an aria-label (accessible name for the icon-only button) and the
    // same text as a hover tooltip.
    function control(kind : string, icon : string, label : string) : EditorToolbarItem
    {
        return { kind, icon, 'aria-label': label, 'tooltip': { text: label } };
    }

    function markControl(mark : MarkName, icon : string, label : string) : EditorToolbarItem
    {
        return { 'kind': 'mark', mark, icon, 'aria-label': label, 'tooltip': { text: label } };
    }

    // Groups render left-to-right with a separator between each. The paragraph-style item is a dropdown, not three
    // heading buttons: UEditorToolbar swaps its button label to the active child, so it reads as the current block and
    // applies on select. indent/outdent ride list nesting (sink/lift), the only indent that survives the round-trip.
    const items : EditorToolbarItem[][] = [
        [
            control('undo', 'i-lucide-undo-2', 'Undo'),
            control('redo', 'i-lucide-redo-2', 'Redo'),
        ],
        [
            {
                'label': 'Normal text',
                'aria-label': 'Text style',
                'tooltip': { text: 'Text style' },
                'items': [
                    [
                        { kind: 'paragraph', label: 'Normal text', icon: 'i-lucide-pilcrow' },
                        { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
                        { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
                        { kind: 'heading', level: 3, label: 'Heading 3', icon: 'i-lucide-heading-3' },
                    ],
                ],
            },
        ],
        [
            markControl('bold', 'i-lucide-bold', 'Bold'),
            markControl('italic', 'i-lucide-italic', 'Italic'),
            markControl('strike', 'i-lucide-strikethrough', 'Strikethrough'),
            markControl('code', 'i-lucide-code', 'Inline code'),
        ],
        [
            control('link', 'i-lucide-link', 'Link'),
        ],
        [
            control('bulletList', 'i-lucide-list', 'Bullet list'),
            control('orderedList', 'i-lucide-list-ordered', 'Numbered list'),
            control('taskList', 'i-lucide-list-checks', 'Task list'),
            control('outdent', 'i-lucide-indent-decrease', 'Outdent'),
            control('indent', 'i-lucide-indent-increase', 'Indent'),
        ],
        [
            control('blockquote', 'i-lucide-text-quote', 'Blockquote'),
            control('codeBlock', 'i-lucide-square-code', 'Code block'),
            {
                'icon': 'i-lucide-plus',
                'aria-label': 'Insert',
                'tooltip': { text: 'Insert' },
                'items': [
                    [
                        { kind: 'table', label: 'Table', icon: 'i-lucide-table' },
                        { kind: 'horizontalRule', label: 'Horizontal rule', icon: 'i-lucide-minus' },
                    ],
                ],
            },
        ],
    ];
</script>

<!--------------------------------------------------------------------------------------------------------------------->
