<!----------------------------------------------------------------------------------------------------------------------
  -- PDF View Menu
  --
  -- Everything about how the document is presented rather than what is in it: rotation, what a drag does, page layout,
  -- the ends of the document, full screen, print, and the properties dialog.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UDropdownMenu :items="items">
        <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="View options"
        />
    </UDropdownMenu>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';
    import type { DropdownMenuItem } from '@nuxt/ui';

    // Stores
    import { usePdfAnnotatorStore } from '../../../stores/pdfAnnotator.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfViewMenu' });

    const emit = defineEmits<{
        present : [];
    }>();

    const store = usePdfAnnotatorStore();

    //------------------------------------------------------------------------------------------------------------------

    const SCROLL_LABELS = [
        { value: 'vertical', label: 'Vertical scrolling', icon: 'i-lucide-move-vertical' },
        { value: 'horizontal', label: 'Horizontal scrolling', icon: 'i-lucide-move-horizontal' },
        { value: 'wrapped', label: 'Wrapped scrolling', icon: 'i-lucide-layout-grid' },
        { value: 'page', label: 'Single page', icon: 'i-lucide-square' },
    ] as const;

    const SPREAD_LABELS = [
        { value: 'none', label: 'No spreads' },
        { value: 'odd', label: 'Odd spreads' },
        { value: 'even', label: 'Even spreads' },
    ] as const;

    const scrollItems = computed<DropdownMenuItem[]>(() => SCROLL_LABELS.map((entry) => ({
        label: entry.label,
        icon: entry.icon,
        type: 'checkbox' as const,
        checked: store.scrollMode === entry.value,
        onSelect: () => { store.setScrollMode(entry.value); },
    })));

    const spreadItems = computed<DropdownMenuItem[]>(() => SPREAD_LABELS.map((entry) => ({
        label: entry.label,
        type: 'checkbox' as const,
        checked: store.spreadMode === entry.value,
        onSelect: () => { store.setSpreadMode(entry.value); },
    })));

    const items = computed<DropdownMenuItem[][]>(() =>
    {
        return [
            [
                { label: 'Rotate right', icon: 'i-lucide-rotate-cw', onSelect: () => { store.rotateCW(); } },
                { label: 'Rotate left', icon: 'i-lucide-rotate-ccw', onSelect: () => { store.rotateCCW(); } },
            ],
            [
                {
                    label: 'Text select',
                    icon: 'i-lucide-text-cursor',
                    type: 'checkbox' as const,
                    checked: store.cursorTool === 'select',
                    onSelect: () => { store.setCursorTool('select'); },
                },
                {
                    label: 'Pan',
                    icon: 'i-lucide-hand',
                    type: 'checkbox' as const,
                    checked: store.cursorTool === 'pan',
                    onSelect: () => { store.setCursorTool('pan'); },
                },
            ],
            [
                { label: 'Page layout', icon: 'i-lucide-book-open', children: scrollItems.value },
                { label: 'Facing pages', icon: 'i-lucide-columns-2', children: spreadItems.value },
            ],
            [
                { label: 'First page', icon: 'i-lucide-chevrons-up', onSelect: () => { store.firstPage(); } },
                { label: 'Last page', icon: 'i-lucide-chevrons-down', onSelect: () => { store.lastPage(); } },
            ],
            [
                { label: 'Full screen', icon: 'i-lucide-expand', onSelect: () => { emit('present'); } },
                {
                    label: 'Print',
                    icon: 'i-lucide-printer',
                    onSelect: () => { void store.print(); },
                },
            ],
            [
                {
                    label: 'Document properties',
                    icon: 'i-lucide-info',
                    onSelect: () => { store.openProperties(); },
                },
            ],
        ];
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
