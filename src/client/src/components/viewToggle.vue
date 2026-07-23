<!----------------------------------------------------------------------------------------------------------------------
  -- View Toggle
  --
  -- The grid/list switch shared by every file surface (drive, shared, trash). The active mode reads solid, the other
  -- outline, so the current choice is unmistakable. It carries no preference of its own -- the surface owns the value
  -- and persists the pick; this only reports which way the user clicked.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UFieldGroup>
        <UButton
            icon="i-lucide-layout-grid"
            color="neutral"
            :variant="viewMode === 'grid' ? 'solid' : 'outline'"
            aria-label="Grid view"
            @click="emit('set-view', 'grid')"
        />
        <UButton
            icon="i-lucide-list"
            color="neutral"
            :variant="viewMode === 'list' ? 'solid' : 'outline'"
            aria-label="List view"
            @click="emit('set-view', 'list')"
        />
    </UFieldGroup>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { ViewMode } from '@fileshed/core';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        viewMode : ViewMode;
    }>();

    const emit = defineEmits<{
        'set-view' : [ mode : ViewMode ];
    }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
