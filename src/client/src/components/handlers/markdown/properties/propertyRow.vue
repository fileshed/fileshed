<!----------------------------------------------------------------------------------------------------------------------
  -- Property Row
  --
  -- A row spans its parent grid's three columns through subgrid, so the parent must be a three-column grid for keys
  -- and controls to line up across rows.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="col-span-3 grid grid-cols-subgrid items-center">
        <span class="truncate text-sm text-muted" :title="property.key">{{ property.key }}</span>

        <UInput
            v-if="property.kind === 'text'"
            :model-value="property.value"
            :readonly="readOnly"
            :aria-label="property.key"
            size="sm"
            class="w-full"
            @update:model-value="emit('update', String($event))"
        />
        <UInput
            v-else-if="property.kind === 'number'"
            v-model="numberDraft"
            :readonly="readOnly"
            :aria-label="property.key"
            inputmode="decimal"
            size="sm"
            class="w-full"
            @update:model-value="onNumberInput"
            @blur="resetNumber"
        />
        <UInput
            v-else-if="property.kind === 'date'"
            type="date"
            :model-value="property.value"
            :readonly="readOnly"
            :aria-label="property.key"
            size="sm"
            class="w-full"
            @update:model-value="onDateInput"
        />
        <UCheckbox
            v-else-if="property.kind === 'checkbox'"
            :model-value="property.value"
            :disabled="readOnly"
            :aria-label="property.key"
            @update:model-value="emit('update', $event === true)"
        />
        <UInputTags
            v-else-if="property.kind === 'list'"
            :model-value="property.value"
            :disabled="readOnly"
            :aria-label="property.key"
            placeholder="Add…"
            size="sm"
            class="w-full"
            add-on-blur
            add-on-paste
            @update:model-value="emit('update', $event.map(String))"
        />
        <pre
            v-else
            class="overflow-x-auto rounded-md bg-elevated px-2 py-1 font-mono text-xs text-toned"
        >{{ property.yaml }}</pre>

        <UButton
            v-if="!readOnly"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Remove ${ property.key }`"
            @click="emit('remove')"
        />
        <span v-else />

        <p v-if="note" class="col-span-2 col-start-2 text-xs text-warning">
            {{ note }}
        </p>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';

    // Engines
    import { checkProperty } from '../../../../engines/markdown/frontmatterKeys.ts';
    import type { Property, PropertyValue } from '../../../../engines/markdown/properties.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownPropertyRow' });

    const props = defineProps<{
        property : Property;
        readOnly : boolean;
    }>();

    const emit = defineEmits<{
        update : [ value : PropertyValue ];
        remove : [];
    }>();

    const note = computed(() => checkProperty(props.property));

    // Typed as text: a half-typed "1." or "-" stays in the field and goes out only once it reads as a finite number.
    const numberDraft = ref(props.property.kind === 'number' ? String(props.property.value) : '');

    watch(() => props.property, (property) =>
    {
        if(property.kind === 'number' && Number(numberDraft.value) !== property.value)
        {
            numberDraft.value = String(property.value);
        }
    });

    function onNumberInput(text : string | number) : void
    {
        const value = Number(text);
        if(String(text).trim() !== '' && Number.isFinite(value)) { emit('update', value); }
    }

    function resetNumber() : void
    {
        if(props.property.kind === 'number') { numberDraft.value = String(props.property.value); }
    }

    // Clearing a date input yields '', which would turn the property into empty text; removing it is the remove button.
    function onDateInput(value : string | number) : void
    {
        if(value !== '') { emit('update', String(value)); }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
