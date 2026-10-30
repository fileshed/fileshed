<!----------------------------------------------------------------------------------------------------------------------
  -- View Toggle
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
