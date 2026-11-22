<!----------------------------------------------------------------------------------------------------------------------
  -- Edit Properties Modal
  --
  -- Opened imperatively from the header. Edits a draft of the frontmatter YAML, as typed rows or as the raw text, and
  -- writes it into the file only on Apply. YAML that doesn't read as properties opens in the YAML view beside its
  -- parse error, and Apply waits until it parses, so the modal never writes frontmatter it can't read back. A viewer
  -- gets both views with nothing editable.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Properties" :ui="{ content: 'sm:max-w-xl' }">
        <template #body>
            <div class="flex flex-col gap-4">
                <UFieldGroup class="self-start">
                    <UButton
                        :variant="view === 'fields' ? 'solid' : 'outline'"
                        :disabled="draftState.kind === 'raw'"
                        color="neutral"
                        size="sm"
                        icon="i-lucide-list"
                        label="Properties"
                        @click="view = 'fields'"
                    />
                    <UButton
                        :variant="view === 'yaml' ? 'solid' : 'outline'"
                        color="neutral"
                        size="sm"
                        icon="i-lucide-code"
                        label="YAML"
                        @click="view = 'yaml'"
                    />
                </UFieldGroup>

                <template v-if="view === 'fields'">
                    <div
                        v-if="properties.length > 0"
                        class="grid grid-cols-[minmax(5rem,10rem)_minmax(0,1fr)_auto] gap-x-3 gap-y-2"
                    >
                        <PropertyRow
                            v-for="property in properties"
                            :key="property.key"
                            :property="property"
                            :read-only="readOnly"
                            @update="onUpdate(property.key, $event)"
                            @remove="onRemove(property.key)"
                        />
                    </div>
                    <p v-else class="text-sm text-muted">
                        No properties yet.
                    </p>

                    <AddPropertyForm v-if="!readOnly" :keys="keys" @add="onUpdate" />
                </template>

                <template v-else>
                    <UAlert
                        v-if="draftState.kind === 'raw'"
                        color="warning"
                        variant="subtle"
                        icon="i-lucide-triangle-alert"
                        title="This YAML can't be shown as properties"
                    >
                        <template #description>
                            <pre class="font-mono text-xs whitespace-pre-wrap">{{ draftState.error }}</pre>
                        </template>
                    </UAlert>

                    <UTextarea
                        v-model="draft"
                        :readonly="readOnly"
                        :rows="8"
                        :maxrows="20"
                        :ui="{ base: 'font-mono text-sm' }"
                        aria-label="Frontmatter YAML"
                        spellcheck="false"
                        autoresize
                        class="w-full"
                    />
                </template>

                <div class="flex justify-end gap-2">
                    <UButton v-if="readOnly" color="neutral" variant="ghost" label="Close" @click="open = false" />
                    <template v-else>
                        <UButton color="neutral" variant="ghost" label="Cancel" @click="open = false" />
                        <UButton label="Apply" :disabled="!changed || draftState.kind === 'raw'" @click="onApply" />
                    </template>
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    // Stores
    import { useEditorStore } from '../../../../stores/editor.ts';
    import { useFrontmatterStore } from '../../../../stores/frontmatter.ts';

    // Engines
    import {
        type Property,
        type PropertyValue,
        parseFrontmatter,
        removeProperty,
        updateProperty,
    } from '../../../../engines/markdown/properties.ts';

    // Components
    import AddPropertyForm from '../properties/addPropertyForm.vue';
    import PropertyRow from '../properties/propertyRow.vue';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'MarkdownEditPropertiesModal' });

    const editor = useEditorStore();
    const frontmatter = useFrontmatterStore();

    const open = ref(false);
    const view = ref<'fields' | 'yaml'>('fields');
    const original = ref('');
    const draft = ref('');

    const readOnly = computed(() => editor.readOnly);
    const draftState = computed(() => parseFrontmatter(draft.value));
    const properties = computed<Property[]>(() =>
    {
        return draftState.value.kind === 'properties' ? draftState.value.properties : [];
    });
    const keys = computed(() => properties.value.map((property) => property.key));
    const changed = computed(() => draft.value !== original.value);

    function openModal() : void
    {
        original.value = frontmatter.yaml ?? '';
        draft.value = original.value;
        view.value = draftState.value.kind === 'raw' ? 'yaml' : 'fields';
        open.value = true;
    }

    function onUpdate(key : string, value : PropertyValue) : void
    {
        draft.value = updateProperty(draft.value, key, value);
    }

    function onRemove(key : string) : void
    {
        draft.value = removeProperty(draft.value, key);
    }

    function onApply() : void
    {
        frontmatter.apply(draft.value);
        open.value = false;
    }

    defineExpose({ open: openModal });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
