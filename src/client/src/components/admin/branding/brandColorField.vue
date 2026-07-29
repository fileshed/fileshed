<!----------------------------------------------------------------------------------------------------------------------
  -- Brand Color Field
  --
  -- One brand color as a picker, a hex field, preset chips, and the generated eleven-shade ramp -- the admin sees
  -- the palette they just made, plus a contrast readout against white text because that is the mistake everyone
  -- makes. Null means the stock build-time color; the field never invents a value until the admin picks one.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <BrandingField
        :title="label"
        :resettable="modelValue !== null"
        @reset="emit('update:modelValue', null)"
    >
        <p class="mt-1 text-sm text-muted">
            {{ description }}
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
            <UPopover>
                <button
                    type="button"
                    class="size-8 rounded-md border border-accented"
                    :style="{ backgroundColor: modelValue ?? ramp['500'] }"
                    :aria-label="`Pick the ${ label.toLowerCase() }`"
                />
                <template #content>
                    <UColorPicker
                        :model-value="modelValue ?? '#808080'"
                        class="p-2"
                        @update:model-value="emit('update:modelValue', $event ?? null)"
                    />
                </template>
            </UPopover>

            <UInput
                v-model="hexDraft"
                placeholder="#rrggbb"
                class="w-28 font-mono"
                @keydown.enter="commitHex"
                @blur="commitHex"
            />

            <div class="flex items-center gap-1">
                <button
                    v-for="preset of PRESETS"
                    :key="preset"
                    type="button"
                    class="size-5 rounded-full border border-default"
                    :style="{ backgroundColor: preset }"
                    :aria-label="`Use ${ preset }`"
                    @click="emit('update:modelValue', preset)"
                />
            </div>
        </div>

        <div class="mt-3 flex h-6 overflow-hidden rounded-md border border-default" data-testid="ramp">
            <div
                v-for="shade of shadeKeys"
                :key="shade"
                class="flex-1"
                :style="{ backgroundColor: ramp[shade] }"
                :title="`${ shade }: ${ ramp[shade] }`"
            />
        </div>
        <p v-if="contrast !== null" class="mt-2 text-xs" :class="readable ? 'text-muted' : 'text-warning'">
            White text on this color: {{ contrast.toFixed(1) }}:1
            {{ readable ? '✓' : '— below 4.5:1, consider a darker shade' }}
        </p>
    </BrandingField>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';

    import { type ColorRamp, colorRamp, contrastRatio, parseHexColor, shadeKeys } from '@fileshed/core';

    // Components
    import BrandingField from './brandingField.vue';

    // Utils
    import { stockHexFor, stockRampFor } from '../../../utils/stockTheme.ts';

    //------------------------------------------------------------------------------------------------------------------

    const WCAG_READABLE = 4.5;

    const PRESETS = [
        '#ef4444',
        '#f97316',
        '#f59e0b',
        '#10b981',
        '#14b8a6',
        '#0ea5e9',
        '#3b82f6',
        '#8b5cf6',
        '#d946ef',
        '#f43f5e',
    ];

    const props = defineProps<{
        label : string;
        description : string;
        token : 'primary' | 'secondary';
        modelValue : string | null;
    }>();

    const emit = defineEmits<{ 'update:modelValue' : [ value : string | null ] }>();

    // The input always carries the EFFECTIVE hex -- the override when set, the default color otherwise -- so
    // the field never shows an empty box next to a colored swatch. Unsetting happens through Use default, not
    // by emptying the input: garbage and blanks quietly restore the effective value.
    const stockHex = computed(() => stockHexFor(props.token) ?? '');
    const effectiveHex = computed(() => props.modelValue ?? stockHex.value);

    const hexDraft = ref(effectiveHex.value);
    watch(effectiveHex, (value) => { hexDraft.value = value; });

    function commitHex() : void
    {
        const trimmed = hexDraft.value.trim().toLowerCase();

        if(parseHexColor(trimmed) === null || trimmed === effectiveHex.value)
        {
            hexDraft.value = effectiveHex.value;
            return;
        }

        emit('update:modelValue', trimmed);
    }

    // Unset shows the STOCK ramp straight from the live tokens -- the admin sees what "stock" actually looks
    // like, sourced from the stylesheet itself so it can never drift from the build.
    const ramp = computed<ColorRamp>(() =>
    {
        return props.modelValue === null ? stockRampFor(props.token) : colorRamp(props.modelValue);
    });
    // Null while unset -- there is no measurement to show for a color the admin has not picked.
    const contrast = computed(() =>
    {
        return props.modelValue === null ? null : contrastRatio(props.modelValue, '#ffffff');
    });
    const readable = computed(() => contrast.value !== null && contrast.value >= WCAG_READABLE);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
