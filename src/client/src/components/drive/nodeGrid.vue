<!----------------------------------------------------------------------------------------------------------------------
  -- Node Grid
  --
  -- The default drive surface: a wall of tiles, as many across as the viewport has room for. Dumb container -- it lays
  -- the tiles out and relays their selection and open intents up; the store owns the data and the view owns the menu.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <VirtualScroller
        ref="scroller"
        :items="nodes"
        :item-height="LISTING_TILE_HEIGHT"
        :columns="columns"
        :gap="LISTING_GRID_GAP"
        @empty-click="emit('clear-empty')"
        @reached="(index : number) => emit('reached', index)"
    >
        <template #default="{ item } : { item : NodeResponse }">
            <NodeTile
                :node="item"
                :selected="selection.has(item.id)"
                :menu-items="buildMenu(item)"
                @select="(n, event) => emit('select', n, event)"
                @open="(n) => emit('open', n)"
            />
        </template>
    </VirtualScroller>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { useTemplateRef } from 'vue';
    import type { ContextMenuItem } from '@nuxt/ui';

    import { LISTING_GRID_GAP, LISTING_TILE_HEIGHT, type NodeResponse } from '@fileshed/core';

    // Components
    import NodeTile from './nodeTile.vue';
    import VirtualScroller from '../listing/virtualScroller.vue';

    // Resource Access
    import { useListingMetrics } from '../../resource-access/listingMetrics.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        nodes : NodeResponse[];
        selection : ReadonlySet<string>;
        buildMenu : (node : NodeResponse) => ContextMenuItem[][];
    }>();

    const emit = defineEmits<{
        'select' : [ node : NodeResponse, event : MouseEvent ];
        'open' : [ node : NodeResponse ];
        'reached' : [ index : number ];
        'clear-empty' : [];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const { columns } = useListingMetrics();
    const scroller = useTemplateRef('scroller');

    function scrollToIndex(index : number) : void
    {
        scroller.value?.scrollToIndex(index);
    }

    defineExpose({ scrollToIndex });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
