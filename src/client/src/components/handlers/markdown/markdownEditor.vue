<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Editor
  --
  -- The WYSIWYG markdown handler's single mount component, and the markdown twin of the text family's editing surface.
  -- It mirrors that surface's host contract exactly so integration is a registry entry plus one host case:
  --
  --   props   modelValue : string   -- the markdown source buffer (store.buffer)
  --           mode       : EditorMode
  --           readOnly   : boolean
  --           theme      : string   -- CodeMirror colorscheme id, for Source mode
  --           gutter     : boolean  -- CodeMirror line-number gutter, for Source mode
  --   emits   update:modelValue : [ string ]   -- wire to store.setBuffer
  --
  -- It reads as a word processor: the file identity (name, save state, Preview/Source, Save) teleports into the layout
  -- header via the identity bar, a fixed formatting toolbar pins below it in WYSIWYG mode, and the document is an
  -- elevated page on a darker scrolling canvas. The surface is Nuxt UI's UEditor (TipTap with GFM markdown
  -- serialization); the formatting toolbar, a slimmed bubble toolbar (B/I/S/link) on selection, and a slash menu for
  -- block insertion all mount inside the UEditor slot so they inject its handler registry. Only honestly-serializable
  -- features are offered: task lists, tables, strikethrough, and code blocks all round-trip to real GFM. Images are out
  -- -- the image extension is disabled, so a pasted or dropped image is a no-op rather than an inlined base64 blob.
  --
  -- Normalization policy. Serializing back to markdown normalizes formatting, so to keep the saved diff honest the
  -- buffer is written only on a real edit, never on a view. The initial content rides UEditor's constructor (no update
  -- fires). A genuine edit emits the re-serialized (normalized) markdown; merely viewing does not -- every resync (a
  -- toggle back from Source, an external reload) goes through setContent with emitUpdate off, so it never counts as an
  -- edit. Source edits write the buffer verbatim. The accepted tradeoff: the first WYSIWYG edit of a hand-authored file
  -- may reflow its markdown to the serializer's house style.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="md-doc flex h-full flex-col overflow-hidden">
        <MarkdownIdentityBar :view="view" @update:view="switchView" />

        <div class="relative min-h-0 flex-1 overflow-hidden">
            <!-- v-show on a plain element, not the component: hiding must never depend on directive transfer to a
                 third-party component's root, and the slot's structure must stay stable across the toggle. -->
            <div v-show="view === 'wysiwyg'" class="h-full">
                <UEditor
                    ref="editorRef"
                    content-type="markdown"
                    :model-value="initialContent"
                    :editable="!readOnly"
                    :image="false"
                    :mention="false"
                    :starter-kit="{
                        underline: false,
                        document: false,
                        paragraph: false,
                        hardBreak: false,
                        blockquote: false,
                        listItem: false,
                    }"
                    :markdown="markdownOptions"
                    :extensions="extraExtensions"
                    :handlers="editorHandlers"
                    :ui="{
                        root: 'flex h-full min-h-0 flex-col',
                        content: 'min-h-0 flex-1 overflow-y-auto bg-default p-4',
                        base: 'mx-auto min-h-full max-w-3xl rounded-lg border border-accented bg-elevated px-8'
                            + ' py-12 sm:px-12',
                    }"
                    @update:model-value="onEditorUpdate"
                >
                    <template #default="{ editor }">
                        <!-- No view condition here: the wrapper's v-show already hides the whole subtree in Source
                             mode, and toggling structure INSIDE a third-party-managed slot breaks Vue's patch
                             anchors. -->
                        <div v-if="!readOnly" class="shrink-0 border-b border-default px-4 py-1">
                            <MarkdownFormatToolbar :editor="editor" class="mx-auto w-full max-w-3xl" />
                        </div>
                        <UEditorToolbar :editor="editor" layout="bubble" :items="bubbleItems" />
                        <UEditorSuggestionMenu :editor="editor" :items="slashItems" />
                    </template>
                </UEditor>
            </div>

            <TextEditor
                v-if="view === 'source'"
                class="h-full"
                :model-value="modelValue"
                :mode="mode"
                :read-only="readOnly"
                :theme="theme"
                :gutter="gutter"
                @update:model-value="onSourceInput"
            />
        </div>

        <ConflictModal
            v-model:open="conflictOpen"
            :busy="store.saving"
            @reload="store.reload()"
            @overwrite="store.overwrite()"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<style scoped>
    /* The line model: no synthetic vertical spacing anywhere. Every block margin is zero, so consecutive lines
       touch and the only space between blocks is a real, cursor-addressable empty paragraph -- one row of space is
       always exactly one blank line in the file. */
    .md-doc :deep(.tiptap p),
    .md-doc :deep(.tiptap > *) {
        margin-block: 0;
    }

    /* Task lists and tables are the two GFM structures the editor theme doesn't paint; everything else (headings,
       code, quotes, lists, links, rules) rides Nuxt UI's own prose styling. */
    .md-doc :deep(ul[data-type="taskList"]) {
        list-style: none;
        padding-inline-start: 0;
    }

    .md-doc :deep(ul[data-type="taskList"] li) {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
    }

    .md-doc :deep(ul[data-type="taskList"] li > label) {
        margin-top: 0.25rem;
        user-select: none;
    }

    .md-doc :deep(ul[data-type="taskList"] li > div) {
        flex: 1 1 auto;
        min-width: 0;
    }

    .md-doc :deep(ul[data-type="taskList"] input[type="checkbox"]) {
        accent-color: var(--ui-primary);
        width: 1rem;
        height: 1rem;
    }

    .md-doc :deep(.tableWrapper) {
        overflow-x: auto;
    }

    .md-doc :deep(table) {
        width: 100%;
        border-collapse: collapse;
    }

    /* The document page sits on bg-elevated, which dark mode paints the same color as the default border token --
       plain var(--ui-border) cell borders are invisible there. The accented token is the one the page outline
       itself uses, so the grid reads on the same surface. */
    .md-doc :deep(:is(th, td)) {
        border: 1px solid var(--ui-border-accented);
        padding: 0.375rem 0.75rem;
        text-align: start;
        vertical-align: top;
    }

    .md-doc :deep(th) {
        background-color: var(--ui-bg-accented);
        font-weight: 600;
    }
</style>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, useTemplateRef, watch } from 'vue';

    import type { Editor } from '@tiptap/core';
    import { TaskList } from '@tiptap/extension-list';
    import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
    import type { EditorSuggestionMenuItem } from '@nuxt/ui/components/EditorSuggestionMenu.vue';
    import type { EditorToolbarItem } from '@nuxt/ui/components/EditorToolbar.vue';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';

    // Engines
    import type { EditorMode } from '../../../engines/intent/index.ts';
    import {
        BlankLines,
        MarkdownBlockquote,
        MarkdownDocument,
        MarkdownHardBreak,
        MarkdownListItem,
        MarkdownParagraph,
        MarkdownTaskItem,
        lineModelMarked,
    } from '../../../engines/markdown/lineModel.ts';

    // Components
    import ConflictModal from '../text/modals/conflictModal.vue';
    import MarkdownIdentityBar from './identityBar.vue';
    import MarkdownFormatToolbar from './toolbar.vue';
    import TextEditor from '../text/textEditor.vue';

    //------------------------------------------------------------------------------------------------------------------

    type View = 'wysiwyg' | 'source';

    const props = defineProps<{
        modelValue : string;
        mode : EditorMode;
        readOnly : boolean;
        theme : string;
        gutter : boolean;
    }>();

    const emit = defineEmits<{
        'update:modelValue' : [ value : string ];
    }>();

    const store = useEditorStore();
    const view = ref<View>('wysiwyg');

    //------------------------------------------------------------------------------------------------------------------
    // WYSIWYG editor
    //------------------------------------------------------------------------------------------------------------------

    const editorRef = useTemplateRef<{ editor ?: Editor }>('editorRef');

    // Captured once and never reassigned: UEditor takes this as its constructor content (which fires no update), and
    // because the bound value never changes, UEditor's own model watcher never runs -- every resync goes through
    // reparse() instead, where emitUpdate stays off.
    const initialContent = ref(props.modelValue);

    // The task lists, tables, strikethrough, and code blocks the base StarterKit doesn't ship. Strike rides StarterKit;
    // task lists and tables are layered on here. Each serializes to GFM through the markdown extension UEditor adds.
    // Document, paragraph, and hard break are the family's own line-model builds (the stock ones are off above):
    // blocks join on single newlines and blank lines are real empty paragraphs (see engines/markdown/lineModel.ts).
    const markdownOptions = { marked: lineModelMarked };

    const extraExtensions = [
        MarkdownDocument,
        MarkdownBlockquote,
        MarkdownListItem,
        MarkdownParagraph,
        MarkdownHardBreak,
        BlankLines,
        TaskList,
        MarkdownTaskItem.configure({ nested: true }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
    ];

    // The custom kinds the built-in handler set doesn't cover: a GFM table from the insert menu, and indent/outdent as
    // list nesting -- the only indent that survives the markdown round-trip -- sinking or lifting the current item.
    function listItemType(editor : Editor) : 'taskItem' | 'listItem'
    {
        return editor.isActive('taskList') ? 'taskItem' : 'listItem';
    }

    const editorHandlers = {
        table: {
            canExecute: (editor : Editor) => editor.can().insertTable(),
            execute: (editor : Editor) => editor.chain().focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
            isActive: () => false,
        },
        indent: {
            canExecute: (editor : Editor) =>
                editor.can().sinkListItem('listItem') || editor.can().sinkListItem('taskItem'),
            execute: (editor : Editor) => editor.chain().focus()
                .sinkListItem(listItemType(editor)),
            isActive: () => false,
        },
        outdent: {
            canExecute: (editor : Editor) =>
                editor.can().liftListItem('listItem') || editor.can().liftListItem('taskItem'),
            execute: (editor : Editor) => editor.chain().focus()
                .liftListItem(listItemType(editor)),
            isActive: () => false,
        },
    };

    // The bubble toolbar slims to the four inline actions worth a selection: bold, italic, strikethrough, and link.
    // Block formatting lives on the fixed toolbar above the canvas. Each carries an aria-label for its icon button.
    function bubbleMark(mark : 'bold' | 'italic' | 'strike', icon : string, text : string) : EditorToolbarItem
    {
        return { 'kind': 'mark', mark, icon, 'aria-label': text, 'tooltip': { text } };
    }

    const bubbleItems : EditorToolbarItem[][] = [
        [
            bubbleMark('bold', 'i-lucide-bold', 'Bold'),
            bubbleMark('italic', 'i-lucide-italic', 'Italic'),
            bubbleMark('strike', 'i-lucide-strikethrough', 'Strikethrough'),
            { 'kind': 'link', 'icon': 'i-lucide-link', 'aria-label': 'Link', 'tooltip': { text: 'Link' } },
        ],
    ];

    const slashItems : EditorSuggestionMenuItem[][] = [
        [
            { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
            { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
            { kind: 'heading', level: 3, label: 'Heading 3', icon: 'i-lucide-heading-3' },
            { kind: 'paragraph', label: 'Text', icon: 'i-lucide-pilcrow' },
        ],
        [
            { kind: 'bulletList', label: 'Bullet list', icon: 'i-lucide-list' },
            { kind: 'orderedList', label: 'Numbered list', icon: 'i-lucide-list-ordered' },
            { kind: 'taskList', label: 'Task list', icon: 'i-lucide-list-checks' },
        ],
        [
            { kind: 'blockquote', label: 'Quote', icon: 'i-lucide-text-quote' },
            { kind: 'codeBlock', label: 'Code block', icon: 'i-lucide-code' },
            { kind: 'table', label: 'Table', icon: 'i-lucide-table' },
            { kind: 'horizontalRule', label: 'Divider', icon: 'i-lucide-minus' },
        ],
    ];

    // A genuine WYSIWYG edit -- UEditor only fires this on a real document change, never on construction or an
    // emitUpdate-off setContent -- so this is the sole path that writes the buffer.
    function onEditorUpdate(value : string) : void
    {
        emit('update:modelValue', value);
    }

    // Push markdown into the live document without counting as an edit: the resync path (a toggle back from Source, an
    // external reload) that must stay off the buffer-write path.
    function reparse(markdown : string) : void
    {
        editorRef.value?.editor?.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    }

    // An external buffer change while WYSIWYG is showing -- a reload, or a deep-link swap -- is re-parsed into the
    // document. A change that already matches the current serialization is this editor's own echo and is skipped, so
    // binding the buffer both ways never loops.
    watch(() => props.modelValue, (value) =>
    {
        if(view.value !== 'wysiwyg') { return; }

        const editor = editorRef.value?.editor;
        if(editor && value !== editor.getMarkdown()) { reparse(value); }
    });

    // emitUpdate stays off: flipping editability is not an edit and must never write the buffer.
    watch(() => props.readOnly, (readOnly) =>
    {
        editorRef.value?.editor?.setEditable(!readOnly, false);
    });

    //------------------------------------------------------------------------------------------------------------------
    // Mode
    //------------------------------------------------------------------------------------------------------------------

    // Switching to WYSIWYG re-parses the current buffer so any Source edits are picked up; switching to Source needs
    // nothing, since the buffer already holds the verbatim source (clean) or the last serialization (edited).
    function switchView(next : View) : void
    {
        if(next === view.value) { return; }
        if(next === 'wysiwyg') { reparse(props.modelValue); }
        view.value = next;
    }

    function onSourceInput(value : string) : void
    {
        emit('update:modelValue', value);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Conflict
    //------------------------------------------------------------------------------------------------------------------

    const conflictOpen = computed<boolean>({
        get: () => store.conflict,
        set: (open) => { if(!open) { store.dismissConflict(); } },
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
