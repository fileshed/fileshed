<!----------------------------------------------------------------------------------------------------------------------
  -- Filter Row
  --
  -- The Type + Modified filter row the Shared and Trash surfaces share -- the same two chips the drive's own bar carries,
  -- minus the owner facet and sort menu those surfaces have no use for. Store-agnostic: the page passes the current
  -- filter state and wires the changes back to whichever store owns the listing, so one row serves both surfaces.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex h-10 items-center gap-2 overflow-x-auto">
        <TypeFilter
            :model-value="typeFamilies"
            @update:model-value="(families) => emit('update:types', families)"
        />
        <ModifiedFilter
            :modified="modified"
            @update:modified="(next) => emit('update:modified', next)"
        />
        <UButton
            v-if="hasActiveFilters"
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            label="Clear all"
            @click="emit('clear')"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { NodeTypeFamily } from '@fileshed/core';

    // Components
    import TypeFilter from './typeFilter.vue';
    import ModifiedFilter from './modifiedFilter.vue';

    // Utils
    import type { ModifiedFilter as ModifiedFilterValue } from '../../utils/filterPresets.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        typeFamilies : NodeTypeFamily[];
        modified : ModifiedFilterValue | null;
        hasActiveFilters : boolean;
    }>();

    const emit = defineEmits<{
        'update:types' : [ families : NodeTypeFamily[] ];
        'update:modified' : [ modified : ModifiedFilterValue | null ];
        'clear' : [];
    }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
