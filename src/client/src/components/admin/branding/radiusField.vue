<!----------------------------------------------------------------------------------------------------------------------
  -- Radius Field
  --
  -- One slider over --ui-radius, with a sample row that inherits the previewed radius naturally -- the proof is
  -- the row itself rounding as the thumb moves. Null means the stock radius.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <BrandingField
        title="Corner radius"
        :resettable="modelValue !== null"
        @reset="emit('update:modelValue', null)"
    >
        <template #meta>
            <span class="font-mono text-xs text-muted">
                {{ modelValue === null ? `default (${ stockValue }rem)` : `${ modelValue }rem` }}
            </span>
        </template>

        <p class="mt-1 text-sm text-muted">
            From sharp corners to soft pills — every control in the app scales from this one value.
        </p>

        <USlider
            :model-value="modelValue ?? stockValue"
            :min="0"
            :max="THEME_RADIUS_MAX"
            :step="0.125"
            class="mt-4"
            aria-label="Corner radius"
            @update:model-value="onSlide"
        />

        <div class="mt-4 flex flex-wrap items-center gap-3">
            <UButton label="Sample button" color="primary" />
            <UInput placeholder="Sample input" class="w-40" />
            <div class="rounded-lg border border-default px-3 py-1.5 text-sm text-muted">
                Sample card
            </div>
        </div>
    </BrandingField>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { THEME_RADIUS_MAX } from '@fileshed/core';

    // Components
    import BrandingField from './brandingField.vue';

    // Utils
    import { stockRadius } from '../../../utils/stockTheme.ts';

    //------------------------------------------------------------------------------------------------------------------

    const stockValue = stockRadius();

    defineProps<{ modelValue : number | null }>();

    const emit = defineEmits<{ 'update:modelValue' : [ value : number | null ] }>();

    function onSlide(value : number | number[] | undefined) : void
    {
        if(typeof value === 'number') { emit('update:modelValue', value); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
