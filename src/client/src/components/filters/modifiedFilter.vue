<!----------------------------------------------------------------------------------------------------------------------
  -- Modified Filter
  --
  -- The Modified chip shared by every filtered surface: a popover of date presets plus a custom range whose inclusive
  -- day span becomes the server's half-open [after, before) window. Presentational only -- it holds the current filter
  -- as a prop and reports a new one; the surface's store owns the reload.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UPopover>
        <UButton
            size="sm"
            color="neutral"
            :variant="modified !== null ? 'solid' : 'subtle'"
            icon="i-lucide-calendar"
            trailing-icon="i-lucide-chevron-down"
            :label="summary === null ? 'Modified' : `Modified: ${ summary }`"
        />

        <template #content="{ close }">
            <div class="flex w-72 max-w-[calc(100vw-2rem)] flex-col p-1">
                <button
                    type="button"
                    class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
                    @click="pickPreset(null, close)"
                >
                    <span class="flex-1 text-left text-sm">Any time</span>
                    <UIcon v-if="modified === null" name="i-lucide-check" class="size-4 text-primary" />
                </button>

                <button
                    v-for="preset in modifiedPresets"
                    :key="preset"
                    type="button"
                    class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-elevated"
                    @click="pickPreset(preset, close)"
                >
                    <span class="flex-1 text-left text-sm">{{ MODIFIED_PRESET_LABELS[preset] }}</span>
                    <UIcon v-if="isActivePreset(preset)" name="i-lucide-check" class="size-4 text-primary" />
                </button>

                <USeparator class="my-1" />

                <div class="p-1">
                    <p class="px-1 pb-1 text-xs font-medium text-muted">
                        Custom range
                    </p>
                    <UCalendar v-model="range" range class="w-full" />
                    <div class="mt-2 flex justify-end gap-2">
                        <UButton size="sm" color="neutral" variant="ghost" label="Cancel" @click="close" />
                        <UButton
                            size="sm"
                            label="Apply"
                            :disabled="!rangeComplete"
                            @click="applyCustom(close)"
                        />
                    </div>
                </div>
            </div>
        </template>
    </UPopover>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, shallowRef } from 'vue';
    import { type DateValue, getLocalTimeZone } from '@internationalized/date';

    // Utils
    import {
        MODIFIED_PRESET_LABELS,
        type ModifiedFilter,
        type ModifiedPreset,
        modifiedFilterSummary,
        modifiedPresets,
    } from '../../utils/filterPresets.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        modified : ModifiedFilter | null;
    }>();

    const emit = defineEmits<{
        'update:modified' : [ modified : ModifiedFilter | null ];
    }>();

    const summary = computed(() => modifiedFilterSummary(props.modified));

    interface CalRange { start : DateValue | undefined; end : DateValue | undefined }
    const range = shallowRef<CalRange | null>(null);

    const rangeComplete = computed(() => range.value?.start !== undefined && range.value?.end !== undefined);

    function isActivePreset(preset : ModifiedPreset) : boolean
    {
        return props.modified?.kind === 'preset' && props.modified.preset === preset;
    }

    function pickPreset(preset : ModifiedPreset | null, close : () => void) : void
    {
        emit('update:modified', preset === null ? null : { kind: 'preset', preset });
        close();
    }

    // The calendar's inclusive day range becomes the server's half-open window: the start day's local midnight, up to
    // (but not including) the local midnight after the end day.
    function applyCustom(close : () => void) : void
    {
        const value = range.value;
        if(value?.start === undefined || value.end === undefined) { return; }

        const tz = getLocalTimeZone();
        const after = value.start.toDate(tz).toISOString();
        const before = value.end.add({ days: 1 }).toDate(tz)
            .toISOString();

        emit('update:modified', { kind: 'range', after, before });
        close();
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
