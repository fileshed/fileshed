<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Document Properties
  --
  -- What the file says about itself. Every field in a PDF's info dictionary is optional, so an absent one is shown as
  -- a dash rather than dropped: a reader looking for the author wants an answer, and "not recorded" is one.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Document properties">
        <template #body>
            <dl v-if="store.properties !== null" class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <template v-for="row in rows" :key="row.label">
                    <dt class="text-muted">
                        {{ row.label }}
                    </dt>
                    <dd class="min-w-0 break-words" :class="row.value === null ? 'text-dimmed' : ''">
                        {{ row.value ?? '—' }}
                    </dd>
                </template>
            </dl>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Stores
    import { usePdfAnnotatorStore } from '../../../../stores/pdfAnnotator.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfDocumentProperties' });

    const store = usePdfAnnotatorStore();

    const open = computed<boolean>({
        get: () => store.propertiesOpen,
        set: (next) => { if(!next) { store.closeProperties(); } },
    });

    const rows = computed<{ label : string; value : string | null }[]>(() =>
    {
        const properties = store.properties;
        if(properties === null) { return []; }

        return [
            { label: 'File name', value: store.node?.name ?? null },
            { label: 'Title', value: properties.title },
            { label: 'Author', value: properties.author },
            { label: 'Subject', value: properties.subject },
            { label: 'Keywords', value: properties.keywords },
            { label: 'Created', value: properties.creationDate },
            { label: 'Modified', value: properties.modificationDate },
            { label: 'Creator', value: properties.creator },
            { label: 'Producer', value: properties.producer },
            { label: 'Version', value: properties.version },
            { label: 'Pages', value: String(properties.pageCount) },
            { label: 'Page size', value: properties.pageSize },
            { label: 'Fast web view', value: properties.linearized ? 'Yes' : 'No' },
        ];
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
