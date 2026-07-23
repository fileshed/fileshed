<!----------------------------------------------------------------------------------------------------------------------
  -- Drive Header
  --
  -- Row one of the drive: the breadcrumb trail and the grid/list view toggle. Constant across selection -- nothing here
  -- reacts to what is selected, so the trail never moves out from under a click.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex items-center gap-2">
        <UBreadcrumb :items="crumbs" class="min-w-0 flex-1" />

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
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { BreadcrumbItem } from '@nuxt/ui';

    // Resource Access
    import type { ViewMode } from '../../resource-access/viewPreference.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        crumbs : BreadcrumbItem[];
        viewMode : ViewMode;
    }>();

    const emit = defineEmits<{
        'set-view' : [ mode : ViewMode ];
    }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
