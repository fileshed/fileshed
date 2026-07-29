<!----------------------------------------------------------------------------------------------------------------------
  -- Type Filter
  --
  -- The Type chip shared by every filtered surface: a multi-select over the node-type families, each carrying its
  -- coloured icon from the shared presentation table. value-key stores just the family on selection, so the model is
  -- the selected families verbatim. Presentational only -- it holds the current selection as a prop and reports a new
  -- one; the surface's store owns the reload.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <USelectMenu
        :model-value="modelValue"
        multiple
        value-key="value"
        :items="typeItems"
        :search-input="false"
        size="sm"
        icon="i-lucide-shapes"
        :color="modelValue.length > 0 ? 'primary' : 'neutral'"
        :variant="modelValue.length > 0 ? 'soft' : 'subtle'"
        :ui="{ content: 'w-56' }"
        @update:model-value="(families : NodeTypeFamily[]) => emit('update:modelValue', families)"
    >
        <template #default>
            Type
        </template>
        <template #item-leading="{ item }">
            <UIcon :name="item.icon" class="size-5" :class="item.color" />
        </template>
    </USelectMenu>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { type NodeTypeFamily, nodeTypeFamilies } from '@fileshed/core';

    // Utils
    import { familyPresentation } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineProps<{
        modelValue : NodeTypeFamily[];
    }>();

    const emit = defineEmits<{
        'update:modelValue' : [ families : NodeTypeFamily[] ];
    }>();

    const typeItems = nodeTypeFamilies.map((family) =>
    {
        const presentation = familyPresentation(family);
        return { value: family, label: presentation.label, icon: presentation.icon, color: presentation.color };
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
