<!----------------------------------------------------------------------------------------------------------------------
  -- Virtual Scroller
  --
  -- The scrolling box every long listing renders into: it owns the scroll, and mounts only the items in view plus a
  -- small margin, so a folder of ten thousand costs the same DOM as a folder of ten. Items are a fixed size -- one
  -- column for a row list, several for a tile grid -- which is what lets it place them without measuring the DOM.
  --
  -- Two things ride out of it that a plain list gives for free: a click that misses every item (the gesture that
  -- clears a selection), and how far the rendered range has reached, which is what asks a listing past the ceiling for
  -- its next chunk.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UScrollArea
        ref="scroller"
        :items="items"
        :virtualize="virtualize"
        class="h-full"
        @click="onClick"
    >
        <template #default="{ item, index } : { item : TItem; index : number }">
            <slot :item="item" :index="index" />
        </template>
    </UScrollArea>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts" generic="TItem">
    import { computed, useTemplateRef, watch } from 'vue';
    import type { ScrollAreaVirtualizeOptions } from '@nuxt/ui';

    //------------------------------------------------------------------------------------------------------------------

    const props = withDefaults(defineProps<{
        items : TItem[];
        itemHeight : number;
        columns ?: number;
        gap ?: number;
        itemKey ?: (item : TItem) => string;
    }>(), { columns: 1, gap: 0, itemKey: undefined });

    const emit = defineEmits<{
        'empty-click' : [];
        'reached' : [ index : number ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const scroller = useTemplateRef('scroller');

    function keyAt(index : number) : string | number
    {
        const item = props.items[index];
        if(item === undefined || props.itemKey === undefined) { return index; }

        return props.itemKey(item);
    }

    const virtualize = computed<ScrollAreaVirtualizeOptions>(() => ({
        estimateSize: props.itemHeight,
        lanes: props.columns,
        gap: props.gap,

        // Every item is the height it was promised, so nothing is gained by measuring them and a good deal is lost:
        // per-item measurement is what makes a long list stutter and its scrollbar creep as it goes.
        skipMeasurement: true,
        getItemKey: keyAt,
    }));

    //------------------------------------------------------------------------------------------------------------------

    // How far down the listing the rendered range now reaches. A listing that is entirely in hand has nothing to do
    // with this; one still arriving uses it to pull the next chunk before the user runs off the end of what is loaded.
    watch(() => scroller.value?.virtualizer?.range?.endIndex, (endIndex) =>
    {
        if(endIndex !== undefined) { emit('reached', endIndex); }
    });

    // A click that landed on the scroller but inside no item is a click on empty space.
    function onClick(event : MouseEvent) : void
    {
        const target = event.target;
        if(target instanceof HTMLElement && target.closest('[data-slot="item"]') === null)
        {
            emit('empty-click');
        }
    }

    function scrollToIndex(index : number) : void
    {
        scroller.value?.virtualizer?.scrollToIndex(index, { align: 'center' });
    }

    defineExpose({ scrollToIndex });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
