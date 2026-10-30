<!----------------------------------------------------------------------------------------------------------------------
  -- Location Line
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <span class="flex min-w-0 items-center gap-1 text-xs text-dimmed" :title="line.full">
        <UIcon
            :name="location.foreign ? 'i-lucide-users' : 'i-lucide-hard-drive'"
            class="size-3 shrink-0"
        />

        <template v-for="(segment, index) in line.segments" :key="`${ index }-${ segment }`">
            <UIcon v-if="index > 0" name="i-lucide-chevron-right" class="size-3 shrink-0 opacity-60" />
            <span class="truncate">{{ segment }}</span>
        </template>
    </span>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { NodeLocation } from '@fileshed/core';

    // Engines
    import { locationLine } from '../../engines/location.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        location : NodeLocation;
        rootLabel : string;
    }>();

    const line = computed(() => locationLine(props.location, props.rootLabel));
</script>

<!--------------------------------------------------------------------------------------------------------------------->
