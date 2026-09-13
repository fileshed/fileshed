<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Alt Text
  --
  -- The description behind an image annotation's alt-text button. pdf.js draws the button on the annotation itself and
  -- then asks a manager to run the dialog; this is that dialog, and the store is what carries the answer back.
  --
  -- Marking an image decorative is the statement that it carries no information a reader would miss, so the text box
  -- goes away with it rather than being kept and ignored.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Image description">
        <template #body>
            <div class="space-y-4">
                <p class="text-sm text-muted">
                    Describe the image for anyone reading this file with a screen reader. The description is saved
                    into the PDF with the image.
                </p>

                <UTextarea
                    v-model="draft"
                    :disabled="decorative"
                    :rows="4"
                    autofocus
                    class="w-full"
                    placeholder="A chart showing quarterly revenue rising through 2026."
                    aria-label="Image description"
                />

                <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                        <p class="text-sm text-default">
                            Decorative
                        </p>
                        <p class="text-xs text-muted">
                            The image is a border, a flourish, or otherwise carries nothing a reader would miss.
                        </p>
                    </div>
                    <USwitch v-model="decorative" size="sm" aria-label="Decorative" />
                </div>

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" @click="store.closeAltText()" />
                    <UButton label="Save" @click="save" />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';

    // Stores
    import { usePdfAnnotatorStore } from '../../../../stores/pdfAnnotator.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfAltText' });

    const store = usePdfAnnotatorStore();

    const draft = ref('');
    const decorative = ref(false);

    const open = computed<boolean>({
        get: () => store.altTextOpen,
        set: (next) => { if(!next) { store.closeAltText(); } },
    });

    // The dialog is one component reused for every image, so it takes the annotation's current description each time
    // it opens rather than holding whatever the last one said.
    watch(() => store.altTextOpen, (opened) =>
    {
        if(!opened) { return; }

        draft.value = store.altText;
        decorative.value = store.altTextDecorative;
    });

    function save() : void
    {
        store.saveAltText(draft.value, decorative.value);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
