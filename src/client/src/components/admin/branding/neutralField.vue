<!----------------------------------------------------------------------------------------------------------------------
  -- Neutral Field
  --
  -- The chrome-warmth knob: five Tailwind gray families as swatch cards, each showing its own shades so the
  -- choice is visible before it is made. Null means the stock family the build ships with.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <BrandingField
        title="Neutral tone"
        :resettable="modelValue !== null"
        @reset="emit('update:modelValue', null)"
    >
        <p class="mt-1 text-sm text-muted">
            The gray family behind text, backgrounds, and borders — the warmth of the whole chrome.
        </p>

        <div class="mt-3 flex flex-wrap gap-2">
            <button
                v-for="family of neutralFamilies"
                :key="family"
                type="button"
                class="flex flex-col items-start gap-1.5 rounded-lg border p-2.5"
                :class="active === family ? 'border-primary ring-1 ring-primary' : 'border-default'"
                :aria-pressed="active === family"
                @click="emit('update:modelValue', family)"
            >
                <span class="flex items-center gap-1.5">
                    <span class="text-sm capitalize" :class="active === family ? 'text-primary' : 'text-default'">
                        {{ family }}
                    </span>
                    <span v-if="modelValue === null && stockFamily === family" class="text-xs text-muted">
                        default
                    </span>
                </span>
                <span class="flex gap-0.5">
                    <span
                        v-for="shade of SAMPLE_SHADES"
                        :key="shade"
                        class="size-4 rounded-sm"
                        :style="{ backgroundColor: neutralPalettes[family][shade] }"
                    />
                </span>
            </button>
        </div>
    </BrandingField>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import { type NeutralFamily, type ShadeKey, neutralFamilies, neutralPalettes } from '@fileshed/core';

    // Components
    import BrandingField from './brandingField.vue';

    // Utils
    import { stockNeutralFamily } from '../../../utils/stockTheme.ts';

    //------------------------------------------------------------------------------------------------------------------

    const SAMPLE_SHADES : ShadeKey[] = [ '100', '300', '500', '700', '900' ];

    const stockFamily = stockNeutralFamily();

    const props = defineProps<{ modelValue : NeutralFamily | null }>();

    const emit = defineEmits<{ 'update:modelValue' : [ value : NeutralFamily | null ] }>();

    // The highlighted card is the EFFECTIVE family: the override when set, the default family otherwise -- an
    // unset knob still has a real answer, and the admin should see it.
    const active = computed(() => props.modelValue ?? stockFamily);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
