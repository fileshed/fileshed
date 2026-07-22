<!----------------------------------------------------------------------------------------------------------------------
  -- Node Grid
  --
  -- The default drive surface: a responsive wall of tiles. Dumb container -- it lays the tiles out and relays their
  -- selection and open intents up; the store owns the data and the view owns the menu.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <NodeTile
            v-for="node in nodes"
            :key="node.id"
            :node="node"
            :selected="selection.has(node.id)"
            :menu-items="buildMenu(node)"
            @select="(n, event) => emit('select', n, event)"
            @open="(n) => emit('open', n)"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { ContextMenuItem } from '@nuxt/ui';

    import type { NodeResponse } from '@fileshed/core';

    // Components
    import NodeTile from './nodeTile.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        nodes : NodeResponse[];
        selection : ReadonlySet<string>;
        buildMenu : (node : NodeResponse) => ContextMenuItem[][];
    }>();

    const emit = defineEmits<{
        select : [ node : NodeResponse, event : MouseEvent ];
        open : [ node : NodeResponse ];
    }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
