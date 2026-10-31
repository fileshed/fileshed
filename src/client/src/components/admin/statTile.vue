<!----------------------------------------------------------------------------------------------------------------------
  -- Stat Tile
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-1 rounded-lg border border-default p-4">
        <div class="flex items-center gap-2 text-sm text-muted">
            <UIcon :name="icon" class="size-4" />
            {{ label }}
        </div>

        <p class="text-2xl font-semibold text-highlighted">
            <slot name="value">
                {{ value }}
            </slot>
        </p>

        <p v-if="detail" class="text-xs text-muted">
            {{ detail }}
        </p>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    defineProps<{
        label : string;
        icon : string;
        value ?: string;
        detail ?: string;
    }>();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
