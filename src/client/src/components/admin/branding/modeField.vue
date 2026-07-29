<!----------------------------------------------------------------------------------------------------------------------
  -- Mode Field
  --
  -- The color-mode policy: the default visitors get before they choose, and the switch that makes it mandatory.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <BrandingField title="Color mode">
        <p class="mt-1 text-sm text-muted">
            The default for visitors who haven't chosen their own.
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-4">
            <USelect
                :model-value="mode"
                :items="MODE_ITEMS"
                class="w-40"
                aria-label="Default color mode"
                @update:model-value="onMode"
            />

            <div class="flex items-center gap-2">
                <USwitch
                    :model-value="forcedMode"
                    aria-label="Force this mode for everyone"
                    @update:model-value="emit('update:forcedMode', $event)"
                />
                <span class="text-sm text-default">Force this mode for everyone</span>
            </div>
        </div>

        <p v-if="forcedMode" class="mt-2 text-xs text-warning">
            Forcing hides the light/dark choice from every user — their own preference stops applying.
        </p>
    </BrandingField>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import type { ColorMode } from '@fileshed/core';

    // Components
    import BrandingField from './brandingField.vue';

    //------------------------------------------------------------------------------------------------------------------

    const MODE_ITEMS = [
        { label: 'System', value: 'system' },
        { label: 'Light', value: 'light' },
        { label: 'Dark', value: 'dark' },
    ];

    defineProps<{
        mode : ColorMode;
        forcedMode : boolean;
    }>();

    const emit = defineEmits<{
        'update:mode' : [ value : ColorMode ];
        'update:forcedMode' : [ value : boolean ];
    }>();

    function onMode(value : unknown) : void
    {
        if(value === 'system' || value === 'light' || value === 'dark') { emit('update:mode', value); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
