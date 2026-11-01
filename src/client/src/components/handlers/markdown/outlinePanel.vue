<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Outline Panel
  --
  -- It lives in the page's left margin. The editor's styles read the md-outline root's data-open to keep the page clear
  -- of it, so the root keeps that class and attribute. The outline follows every transaction rather than every update,
  -- so a resync that fires no update still rebuilds it.
  --
  -- The root fills the margin's height but takes no pointer events, so clicks and scrolling in the empty space between
  -- its children reach the page underneath.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div
        class="md-outline pointer-events-none flex flex-col gap-4 *:pointer-events-auto"
        :class="{ 'w-(--outline-width)': open }"
        :data-open="openAttribute"
    >
        <UTooltip :text="toggleLabel">
            <UButton
                icon="i-lucide-table-of-contents"
                color="neutral"
                :variant="open ? 'soft' : 'ghost'"
                size="sm"
                class="self-start"
                :aria-label="toggleLabel"
                :aria-expanded="open"
                @click="toggle"
            />
        </UTooltip>

        <div v-if="open" class="flex min-h-0 flex-col gap-6 overflow-y-auto">
            <section v-if="tags.length > 0">
                <h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                    Tags
                </h2>
                <div class="flex flex-wrap gap-1.5">
                    <UBadge v-for="tag in tags" :key="tag" :label="tag" color="primary" variant="soft" />
                </div>
            </section>

            <nav aria-label="Outline">
                <h2 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                    Outline
                </h2>
                <p v-if="outline.length === 0" class="text-sm text-muted">
                    Headings you add to the document appear here.
                </p>
                <ul v-else class="border-s border-accented">
                    <li v-for="entry in outline" :key="entry.pos">
                        <button
                            type="button"
                            class="-ms-px block w-full truncate border-s-2 py-1 pe-2 text-start text-sm"
                            :class="[
                                INDENTS[entry.level - topLevel],
                                entry.pos === active?.pos
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-toned hover:text-highlighted',
                            ]"
                            :aria-current="entry.pos === active?.pos ? 'location' : undefined"
                            @click="jumpTo(entry)"
                        >
                            {{ entry.text }}
                        </button>
                    </li>
                </ul>
            </nav>
        </div>

        <MarkdownWordCount
            v-if="open"
            :editor="editor"
            :lang="frontmatter.meta.lang"
            class="mt-auto shrink-0 border-t border-default pt-3"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

    import type { Editor, EditorEvents } from '@tiptap/core';

    // Components
    import MarkdownWordCount from './wordCount.vue';

    // Stores
    import { useFrontmatterStore } from '../../../stores/frontmatter.ts';

    // Engines
    import { type OutlineEntry, buildOutline, findActiveEntry } from '../../../engines/markdown/outline.ts';

    // Resource Access
    import { readOutlinePanelOpen, writeOutlinePanelOpen } from '../../../resource-access/browser/outlinePanel.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownOutlinePanel' });

    const props = defineProps<{
        editor : Editor;
    }>();

    const INDENTS = [ 'ps-3', 'ps-6', 'ps-9', 'ps-12', 'ps-15', 'ps-18' ];

    const frontmatter = useFrontmatterStore();

    const open = ref(readOutlinePanelOpen() ?? true);
    const outline = ref<OutlineEntry[]>(buildOutline(props.editor.state.doc));
    const selection = ref(props.editor.state.selection.from);

    const tags = computed(() => frontmatter.meta.tags);
    const active = computed(() => findActiveEntry(outline.value, selection.value));
    const topLevel = computed(() => Math.min(...outline.value.map((entry) => entry.level)));
    const toggleLabel = computed(() => { return open.value ? 'Hide outline' : 'Show outline'; });
    const openAttribute = computed(() => { return open.value ? '' : undefined; });

    function toggle() : void
    {
        open.value = !open.value;
        writeOutlinePanelOpen(open.value);
    }

    function onTransaction({ transaction } : EditorEvents['transaction']) : void
    {
        if(transaction.docChanged) { outline.value = buildOutline(props.editor.state.doc); }
        selection.value = props.editor.state.selection.from;
    }

    // The caret lands at the start of the heading, and the heading scrolls to the top of the page rather than just
    // into view.
    function jumpTo(entry : OutlineEntry) : void
    {
        props.editor.chain().focus(entry.pos + 1, { scrollIntoView: false })
            .run();

        const heading = props.editor.view.nodeDOM(entry.pos);
        if(heading instanceof HTMLElement) { heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }

    onMounted(() => { props.editor.on('transaction', onTransaction); });
    onBeforeUnmount(() => { props.editor.off('transaction', onTransaction); });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
