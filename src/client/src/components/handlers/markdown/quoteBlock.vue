<!----------------------------------------------------------------------------------------------------------------------
  -- Markdown Quote Block
  --
  -- A quote whose first line is a callout marker draws as that callout. Folding is the reader's own and isn't saved:
  -- a callout marked `-` opens folded every time.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <NodeViewWrapper
        as="blockquote"
        :class="{ 'md-callout': header, 'md-callout-folded': header && folded }"
        :data-color="header ? CALLOUT_STYLES[header.kind].color : undefined"
    >
        <span v-if="header" contenteditable="false" class="md-callout-icon">
            <UIcon :name="CALLOUT_STYLES[header.kind].icon" class="size-4" />
        </span>
        <span v-if="header?.fold" contenteditable="false" class="md-callout-fold">
            <UButton
                :icon="folded ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
                :aria-label="folded ? 'Expand' : 'Collapse'"
                :aria-expanded="!folded"
                size="xs"
                variant="ghost"
                color="neutral"
                @mousedown.prevent
                @click="folded = !folded"
            />
        </span>
        <NodeViewContent />
    </NodeViewWrapper>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<style scoped>
    .md-callout {
        position: relative;
        border-inline-start: 4px solid var(--callout);
        border-radius: var(--ui-radius);
        background-color: color-mix(in oklab, var(--callout) 8%, transparent);
        padding: 0.5rem 2.5rem 0.5rem 2.5rem;
        font-style: normal;
    }

    .md-callout[data-color="blue"] {
        --callout: var(--callout-blue);
    }

    .md-callout[data-color="green"] {
        --callout: var(--callout-green);
    }

    .md-callout[data-color="purple"] {
        --callout: var(--callout-purple);
    }

    .md-callout[data-color="yellow"] {
        --callout: var(--callout-yellow);
    }

    .md-callout[data-color="red"] {
        --callout: var(--callout-red);
    }

    .md-callout[data-color="cyan"] {
        --callout: var(--callout-cyan);
    }

    .md-callout[data-color="gray"] {
        --callout: var(--callout-gray);
    }

    /* The icon and the fold toggle sit in the padding beside the title line, centered on its line box. */
    .md-callout-icon,
    .md-callout-fold {
        position: absolute;
        top: 0.5rem;
        display: flex;
        align-items: center;
        height: 1.5lh;
    }

    .md-callout-icon {
        inset-inline-start: 0.875rem;
        color: var(--callout);
    }

    .md-callout-fold {
        inset-inline-end: 0.5rem;
    }

    .md-callout :deep(.md-callout-title) {
        color: var(--callout);
        font-weight: 600;
    }

    .md-callout-folded :deep([data-node-view-content] > :not(:first-child)) {
        display: none;
    }
</style>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';

    import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';

    // Engines
    import { type CalloutKind, calloutHeaderOf } from '../../../engines/markdown/callouts.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownQuoteBlock' });

    const props = defineProps(nodeViewProps);

    type CalloutColor = 'blue' | 'green' | 'purple' | 'yellow' | 'red' | 'cyan' | 'gray';

    // GitHub's five in GitHub's colors and icons, and Obsidian's others in the colors Obsidian gives them.
    const CALLOUT_STYLES : Readonly<Record<CalloutKind, { color : CalloutColor; icon : string }>> = {
        note: { color: 'blue', icon: 'i-lucide-info' },
        tip: { color: 'green', icon: 'i-lucide-lightbulb' },
        important: { color: 'purple', icon: 'i-lucide-message-square-warning' },
        warning: { color: 'yellow', icon: 'i-lucide-triangle-alert' },
        caution: { color: 'red', icon: 'i-lucide-octagon-alert' },
        abstract: { color: 'cyan', icon: 'i-lucide-clipboard-list' },
        info: { color: 'blue', icon: 'i-lucide-info' },
        todo: { color: 'blue', icon: 'i-lucide-circle-check' },
        success: { color: 'green', icon: 'i-lucide-check' },
        question: { color: 'yellow', icon: 'i-lucide-circle-help' },
        failure: { color: 'red', icon: 'i-lucide-x' },
        danger: { color: 'red', icon: 'i-lucide-zap' },
        bug: { color: 'red', icon: 'i-lucide-bug' },
        example: { color: 'purple', icon: 'i-lucide-list' },
        quote: { color: 'gray', icon: 'i-lucide-quote' },
    };

    const header = computed(() => calloutHeaderOf(props.node));
    const folded = ref(header.value?.fold === 'closed');

    watch(() => header.value?.fold, (fold) => { folded.value = fold === 'closed'; });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
