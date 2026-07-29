<!----------------------------------------------------------------------------------------------------------------------
  -- Sort Header
  --
  -- A sortable column heading: click cycles ascending, descending, unsorted. The arrow shows only while this column
  -- carries the sort.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <button
        type="button"
        class="flex cursor-pointer items-center gap-1 font-medium hover:text-default"
        @click="emit('toggle', sortKey)"
    >
        {{ label }}
        <UIcon v-if="active" :name="icon" class="size-3.5" />
    </button>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { AdminUserSortKey } from '@fileshed/core';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        label : string;
        sortKey : AdminUserSortKey;
        state : { key : AdminUserSortKey; direction : 'asc' | 'desc' } | null;
    }>();

    const emit = defineEmits<{ toggle : [ key : AdminUserSortKey ] }>();

    const active = computed(() => props.state?.key === props.sortKey);
    const icon = computed(() =>
    {
        return props.state?.direction === 'desc' ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up';
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
