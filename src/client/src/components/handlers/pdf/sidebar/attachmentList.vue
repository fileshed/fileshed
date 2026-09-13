<!----------------------------------------------------------------------------------------------------------------------
  -- PDF Attachment List
  --
  -- Files embedded in the PDF. Saving one never reaches the server: the renderer reads the bytes out of the document
  -- it already holds. The format records no length for an embedded file, so none is shown.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <ul v-if="store.attachments.length > 0" class="divide-y divide-default">
        <li
            v-for="attachment in store.attachments"
            :key="attachment.id"
            class="flex items-center gap-2 px-3 py-2"
        >
            <UIcon name="i-lucide-paperclip" class="size-4 shrink-0 text-dimmed" />

            <div class="min-w-0 flex-1">
                <p class="truncate text-sm" :title="attachment.filename">
                    {{ attachment.filename }}
                </p>
                <p v-if="attachment.description !== ''" class="truncate text-xs text-dimmed">
                    {{ attachment.description }}
                </p>
            </div>

            <UButton
                icon="i-lucide-download"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="`Save ${ attachment.filename }`"
                @click="store.saveAttachment(attachment.id, attachment.filename)"
            />
        </li>
    </ul>

    <p v-else class="p-4 text-center text-sm text-dimmed">
        This document has no attachments.
    </p>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    // Stores
    import { usePdfAnnotatorStore } from '../../../../stores/pdfAnnotator.ts';

    //------------------------------------------------------------------------------------------------------------------

    defineOptions({ name: 'PdfAttachmentList' });

    const store = usePdfAnnotatorStore();
</script>

<!--------------------------------------------------------------------------------------------------------------------->
