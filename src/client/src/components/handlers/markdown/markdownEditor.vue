<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Editor
  --
  -- The formatting toolbar, bubble toolbar, and slash menu mount inside the UEditor slot so they can inject its handler
  -- registry. Only features that round-trip to real GFM are offered; the image extension is disabled, so a pasted or
  -- dropped image does nothing rather than inlining a base64 blob.
  --
  -- The buffer is written only on a real edit, never on a view. The initial content goes through UEditor's constructor
  -- (no update fires), and every resync (toggling back from Source, an external reload) goes through setContent with
  -- emitUpdate off. A WYSIWYG edit is merged into the file rather than replacing it with the serializer's output, so
  -- everything the edit didn't touch keeps its own spelling (see engines/markdown/preservation.ts). Source edits write
  -- the buffer verbatim.
  --
  -- WYSIWYG holds only the body: the frontmatter block is split off before parsing and put back verbatim on every
  -- write, so YAML never reaches the markdown parser or the serializer. Source shows the whole file.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="md-doc flex h-full flex-col overflow-hidden">
        <MarkdownIdentityBar :view="view" @update:view="switchView" />

        <div class="relative min-h-0 flex-1 overflow-hidden">
            <!-- v-show on a plain element, not the component: hiding must never depend on directive transfer to a
                 third-party component's root, and the slot's structure must stay stable across the toggle. -->
            <div v-show="view === 'wysiwyg'" class="h-full" :lang="frontmatter.meta.lang ?? undefined">
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
                        codeBlock: false,
                    }"
                    :markdown="markdownOptions"
                    :extensions="extraExtensions"
                    :handlers="editorHandlers"
                    :ui="{
                        root: 'grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)]',
                        content: 'col-start-1 row-start-2 min-h-0 overflow-y-auto bg-default p-4',
                        base: 'min-h-full w-auto max-w-3xl rounded-lg border border-accented bg-elevated px-8'
                            + ' py-12 sm:px-12',
                    }"
                    @update:model-value="onEditorUpdate"
                >
                    <template #default="{ editor }">
                        <!-- No view condition here: the wrapper's v-show already hides the whole subtree in Source
                             mode, and toggling structure INSIDE a third-party-managed slot breaks Vue's patch
                             anchors. -->
                        <div class="row-start-1">
                            <div v-if="!readOnly" class="border-b border-default px-4 py-1">
                                <MarkdownFormatToolbar :editor="editor" class="mx-auto w-full max-w-3xl" />
                            </div>
                            <div class="px-4">
                                <MarkdownHTMLBanner :editor="editor" class="md-html-banner mt-3 w-auto max-w-3xl" />
                            </div>
                        </div>
                        <UEditorToolbar :editor="editor" layout="bubble" :items="bubbleItems" />
                        <UEditorSuggestionMenu :editor="editor" :items="slashItems" />

                        <!-- Shares the scroller's grid cell and stacks above its left margin, so it stays put while the
                             page scrolls. It spans the margin's full height, so the word count sits at the bottom. -->
                        <MarkdownOutlinePanel
                            :editor="editor"
                            class="z-10 col-start-1 row-start-2 my-4 ms-4 min-h-0 self-stretch justify-self-start"
                        />
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

    /* A blank line is an empty paragraph, so the body's line height is also the gap between blocks. The prose theme's
       1.75 is sized for paragraphs that have margins between them. */
    .md-doc :deep(.tiptap :is(p, li)) {
        line-height: 1.5;
    }

    /* The outline panel lives in the page's left margin. The page keeps its centered position while the margin fits
       the panel, and moves right only as far as it must to clear it; the closed panel is just its toggle button. The
       HTML banner above the scroller follows the page. */
    .md-doc {
        --outline-width: 14rem;
        --outline-room: 3rem;
    }

    .md-doc:has(.md-outline[data-open]) {
        --outline-room: calc(var(--outline-width) + 1rem);
    }

    .md-doc :deep(.tiptap),
    .md-doc .md-html-banner {
        margin-inline: max((100% - var(--container-3xl)) / 2, var(--outline-room)) auto;
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

    /* The same surface clash as the table borders: a divider in the default border color vanishes in dark mode. */
    .md-doc :deep(.tiptap hr) {
        border-color: var(--ui-border-accented);
    }

    .md-doc :deep(:is([data-comment], [data-comment-block])) {
        color: var(--ui-text-dimmed);
    }

    .md-doc :deep([data-comment-block]) {
        white-space: pre-wrap;
    }

    .md-doc :deep(.tiptap mark) {
        background-color: color-mix(in oklab, var(--callout-yellow) 30%, transparent);
        color: inherit;
    }

    /* A callout's marker hides while the cursor is off its line; the callout itself draws the type. */
    .md-doc :deep(.md-callout-marker),
    .md-doc :deep(.md-math-hidden) {
        display: none;
    }

    .md-doc :deep(.tiptap [data-inline-math]) {
        font-family: var(--font-mono);
        font-size: 0.875em;
    }

    /* Footnote definitions are drawn at the end of the page in the order their flex order gives them, under a divider,
       while the file keeps them where they are. The page is a column of blocks with no margins, so laying it out as a
       flex column moves nothing else. */
    .md-doc :deep(.tiptap:has(> [data-footnote-definition])) {
        display: flex;
        flex-direction: column;
    }

    .md-doc :deep(.tiptap > *) {
        min-width: 0;
    }

    .md-doc :deep([data-footnote-ref]) {
        cursor: pointer;
        color: var(--ui-primary);
    }

    .md-doc :deep([data-footnote-ref][data-number])::after {
        content: "[" attr(data-number) "]";
    }

    .md-doc :deep([data-footnote-ref]:not([data-number]))::after {
        content: "[^" attr(data-label) "]";
        color: var(--ui-text);
    }

    .md-doc :deep([data-footnote-definition]) {
        position: relative;
        padding-inline-start: 2rem;
        font-size: 0.875em;
    }

    .md-doc :deep([data-footnote-definition])::before {
        content: attr(data-number) ".";
        position: absolute;
        inset-inline-start: 0;
        color: var(--ui-text-muted);
    }

    .md-doc :deep([data-footnote-definition]:not([data-number]))::before {
        content: "[^" attr(data-label) "]:";
        inset-inline-start: -0.5rem;
    }

    .md-doc :deep(.md-footnotes-start) {
        margin-block-start: 1.5rem;
        border-block-start: 1px solid var(--ui-border-accented);
        padding-block-start: 1rem;
    }

    .md-doc :deep(.md-footnotes-start)::before {
        top: 1rem;
    }

    .md-doc :deep(.md-footnote-back) {
        margin-inline-start: 0.25rem;
        color: var(--ui-primary);
        cursor: pointer;
    }
</style>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';

    import type { Editor } from '@tiptap/core';
    import { CodeBlock } from '@tiptap/extension-code-block';
    import { Highlight } from '@tiptap/extension-highlight';
    import { TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
    import { VueNodeViewRenderer, VueWidgetRenderer } from '@tiptap/vue-3';
    import type { EditorSuggestionMenuItem } from '@nuxt/ui/components/EditorSuggestionMenu.vue';
    import type { EditorToolbarItem } from '@nuxt/ui/components/EditorToolbar.vue';

    // Stores
    import { useEditorStore } from '../../../stores/editor.ts';
    import { useFrontmatterStore } from '../../../stores/frontmatter.ts';
    import { useMarkdownHTMLStore } from '../../../stores/markdownHTML.ts';

    // Engines
    import type { EditorMode } from '../../../engines/intent/index.ts';
    import { CalloutMarkers } from '../../../engines/markdown/callouts.ts';
    import { CodeHighlight } from '../../../engines/markdown/codeHighlight.ts';
    import { Comment, CommentBlock } from '../../../engines/markdown/comments.ts';
    import { FootnoteDefinition, FootnoteDisplay, FootnoteReference } from '../../../engines/markdown/footnotes.ts';
    import { replaceBody, splitFrontmatter } from '../../../engines/markdown/frontmatter.ts';
    import { HtmlBlock, HtmlInline } from '../../../engines/markdown/html.ts';
    import { InlineMath, InlineMathPreview, MathBlock } from '../../../engines/markdown/math.ts';
    import { TableOfContents } from '../../../engines/markdown/toc.ts';
    import {
        BlankLines,
        MarkdownBlockquote,
        MarkdownDocument,
        MarkdownHardBreak,
        MarkdownListItem,
        MarkdownParagraph,
        MarkdownTable,
        MarkdownTaskItem,
        MarkdownTaskList,
        lineModelMarked,
    } from '../../../engines/markdown/lineModel.ts';
    import { mergeEdit } from '../../../engines/markdown/preservation.ts';

    // Components
    import ConflictModal from '../text/modals/conflictModal.vue';
    import MarkdownCodeBlock from './codeBlock.vue';
    import MarkdownHTMLBanner from './htmlBanner.vue';
    import MarkdownHTMLBlock from './htmlBlock.vue';
    import MarkdownHTMLInline from './htmlInline.vue';
    import MarkdownIdentityBar from './identityBar.vue';
    import MarkdownInlineMath from './inlineMath.vue';
    import MarkdownMathBlock from './mathBlock.vue';
    import MarkdownFormatToolbar from './toolbar.vue';
    import MarkdownOutlinePanel from './outlinePanel.vue';
    import MarkdownQuoteBlock from './quoteBlock.vue';
    import MarkdownTOCBlock from './tocBlock.vue';
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
    const frontmatter = useFrontmatterStore();
    const markdownHTML = useMarkdownHTMLStore();
    const view = ref<View>('wysiwyg');

    // A choice to show a file's HTML lasts until the reader leaves the file.
    onBeforeUnmount(() => { markdownHTML.hide(); });

    //------------------------------------------------------------------------------------------------------------------
    // WYSIWYG editor
    //------------------------------------------------------------------------------------------------------------------

    const editorRef = useTemplateRef<{ editor ?: Editor }>('editorRef');

    // Captured once and never reassigned: UEditor takes this as its constructor content (which fires no update), and
    // because the bound value never changes, UEditor's own model watcher never runs -- every resync goes through
    // reparse() instead, where emitUpdate stays off.
    const initialContent = ref(splitFrontmatter(props.modelValue).body);

    // The task lists and tables the base StarterKit doesn't ship, layered on here; each serializes to GFM through the
    // markdown extension UEditor adds. Document, paragraph, and hard break are the family's own line-model builds (the
    // stock ones are off above): blocks join on single newlines and blank lines are real empty paragraphs (see
    // engines/markdown/lineModel.ts). The code block replaces StarterKit's with the same node drawn with a language
    // picker or a Mermaid diagram, quotes draw as callouts when they are one, and CodeHighlight colors code and the
    // source of HTML and math blocks.
    const markdownOptions = { marked: lineModelMarked };

    const PreviewCodeBlock = CodeBlock.extend({
        addNodeView: () => VueNodeViewRenderer(MarkdownCodeBlock),
    });
    const PreviewHtmlBlock = HtmlBlock.extend({
        addNodeView: () => VueNodeViewRenderer(MarkdownHTMLBlock),
    });
    const PreviewHtmlInline = HtmlInline.extend({
        addNodeView: () => VueNodeViewRenderer(MarkdownHTMLInline),
    });
    const PreviewBlockquote = MarkdownBlockquote.extend({
        addNodeView: () => VueNodeViewRenderer(MarkdownQuoteBlock),
    });
    const PreviewMathBlock = MathBlock.extend({
        addNodeView: () => VueNodeViewRenderer(MarkdownMathBlock),
    });
    const PreviewTableOfContents = TableOfContents.extend({
        addNodeView: () => VueNodeViewRenderer(MarkdownTOCBlock),
    });
    const PreviewInlineMath = InlineMathPreview.configure({
        widget: (editor, pos, key, latex) =>
        {
            // Ahead of the source, outside its monospace styling.
            return VueWidgetRenderer(MarkdownInlineMath, { editor, pos, key, side: -1, props: { latex } });
        },
    });

    const extraExtensions = [
        PreviewCodeBlock,
        PreviewHtmlBlock,
        PreviewHtmlInline,
        PreviewMathBlock,
        PreviewTableOfContents,
        PreviewInlineMath,
        CodeHighlight,
        CalloutMarkers,
        Comment,
        CommentBlock,
        FootnoteReference,
        FootnoteDefinition,
        FootnoteDisplay,
        InlineMath,
        Highlight,
        MarkdownDocument,
        PreviewBlockquote,
        MarkdownListItem,
        MarkdownParagraph,
        MarkdownHardBreak,
        BlankLines,
        MarkdownTaskList,
        MarkdownTaskItem.configure({ nested: true }),
        MarkdownTable.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
    ];

    // The custom kinds the built-in handler set doesn't cover: a GFM table and a footnote from the insert menu, the
    // highlight mark, and indent/outdent as list nesting -- the only indent that survives the markdown round-trip --
    // sinking or lifting the current item.
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
        footnote: {
            canExecute: (editor : Editor) => editor.can().insertFootnote(),
            execute: (editor : Editor) => editor.chain().focus()
                .insertFootnote(),
            isActive: () => false,
        },
        highlight: {
            canExecute: (editor : Editor) => editor.can().toggleHighlight(),
            execute: (editor : Editor) => editor.chain().focus()
                .toggleHighlight(),
            isActive: (editor : Editor) => editor.isActive('highlight'),
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

    // The bubble toolbar slims to the inline actions worth a selection: bold, italic, strikethrough, highlight, and
    // link. Block formatting lives on the fixed toolbar above the canvas. Each carries an aria-label for its icon
    // button.
    function bubbleMark(mark : 'bold' | 'italic' | 'strike', icon : string, text : string) : EditorToolbarItem
    {
        return { 'kind': 'mark', mark, icon, 'aria-label': text, 'tooltip': { text } };
    }

    const bubbleItems : EditorToolbarItem[][] = [
        [
            bubbleMark('bold', 'i-lucide-bold', 'Bold'),
            bubbleMark('italic', 'i-lucide-italic', 'Italic'),
            bubbleMark('strike', 'i-lucide-strikethrough', 'Strikethrough'),
            {
                'kind': 'highlight',
                'icon': 'i-lucide-highlighter',
                'aria-label': 'Highlight',
                'tooltip': { text: 'Highlight' },
            },
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
            { kind: 'footnote', label: 'Footnote', icon: 'i-lucide-superscript' },
            { kind: 'horizontalRule', label: 'Divider', icon: 'i-lucide-minus' },
        ],
    ];

    // The body as last written, and the serializer's output for the document it was parsed into. An edit is the change
    // from that output to the next one, merged into the body. Neither drives rendering, so neither is reactive.
    let written = initialContent.value;
    let serialized : string | null = null;

    // UEditor builds its editor after mounting, before any edit can happen.
    watch(() => editorRef.value?.editor, (editor) =>
    {
        if(editor) { serialized = editor.getMarkdown(); }
    }, { immediate: true });

    // A genuine WYSIWYG edit -- UEditor only fires this on a real document change, never on construction or an
    // emitUpdate-off setContent -- so this is the sole path that writes the buffer. The merged body goes back behind
    // the file's frontmatter.
    function onEditorUpdate(value : string) : void
    {
        const manager = editorRef.value?.editor?.markdown;
        if(manager && serialized !== null)
        {
            written = mergeEdit({
                file: written,
                before: serialized,
                after: value,
                normalize: (markdown) => manager.serialize(manager.parse(markdown)),
            });
        }
        else
        {
            written = value;
        }

        serialized = value;
        emit('update:modelValue', replaceBody(props.modelValue, written));
    }

    // Push the file's body into the live document without counting as an edit: the resync path (a toggle back from
    // Source, an external reload) that must stay off the buffer-write path.
    function reparse(file : string) : void
    {
        const { body } = splitFrontmatter(file);
        const editor = editorRef.value?.editor;
        editor?.commands.setContent(body, { contentType: 'markdown', emitUpdate: false });

        written = body;
        serialized = editor?.getMarkdown() ?? null;
    }

    // An external buffer change while WYSIWYG is showing -- a reload, a deep-link swap, a properties edit -- is
    // re-parsed into the document. A body that matches what this editor last wrote is its own echo (or a
    // frontmatter-only change) and is skipped, so binding the buffer both ways never loops.
    watch(() => props.modelValue, (value) =>
    {
        if(view.value !== 'wysiwyg') { return; }

        if(editorRef.value?.editor && splitFrontmatter(value).body !== written) { reparse(value); }
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
