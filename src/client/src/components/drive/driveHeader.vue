<!----------------------------------------------------------------------------------------------------------------------
  -- Drive Header
  --
  -- Row one of the drive: the breadcrumb trail and the grid/list view toggle. Constant across selection -- nothing here
  -- reacts to what is selected, so the trail never moves out from under a click.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex items-center gap-2">
        <UBreadcrumb :items="crumbs" class="min-w-0 flex-1">
            <template #link="{ item }">
                <LinkCrumbCard v-if="item.link" :node="item.link.node" :owner="item.link.owner" />
            </template>
        </UBreadcrumb>

        <ViewToggle :view-mode="viewMode" @set-view="(mode) => emit('set-view', mode)" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { ViewMode } from '@fileshed/core';

    // Components
    import ViewToggle from '../viewToggle.vue';
    import LinkCrumbCard from './linkCrumbCard/linkCrumbCard.vue';

    // Types
    import type { DriveCrumb } from './linkCrumbCard/types.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        crumbs : DriveCrumb[];
        viewMode : ViewMode;
    }>();

    const emit = defineEmits<{
        'set-view' : [ mode : ViewMode ];
    }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
