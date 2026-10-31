<!----------------------------------------------------------------------------------------------------------------------
  -- Upload Row
  --
  -- Progress is determinate while hashing or sending, the two phases whose byte counts are known; the brief claim and
  -- verify steps in between animate indeterminately.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex items-center gap-3 py-2">
        <UIcon :name="presentation.icon" :class="[ 'size-5 shrink-0', presentation.color ]" />

        <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm" :title="item.name">{{ item.name }}</span>
                <span class="shrink-0 text-xs text-muted">{{ presentation.label }}</span>
            </div>

            <UProgress
                v-if="showBar"
                :model-value="barValue"
                :max="100"
                size="2xs"
                class="mt-1.5"
            />
            <p
                v-else-if="item.status === 'error'"
                class="mt-0.5 truncate text-xs text-error"
                :title="item.error ?? ''"
            >
                {{ item.error }}
            </p>
        </div>

        <UButton
            v-if="canCancel"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Cancel ${ item.name }`"
            @click="emit('cancel', item.id)"
        />
        <UButton
            v-else-if="item.kind === 'file' && item.status === 'error'"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Retry ${ item.name }`"
            @click="emit('retry', item.id)"
        />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    // Engines
    import { isActiveStatus } from '../../engines/uploads/status.ts';

    // Stores
    import type { UploadItem } from '../../stores/uploads.ts';

    // Utils
    import { uploadStatusPresentation } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{ item : UploadItem }>();

    const emit = defineEmits<{
        cancel : [ id : string ];
        retry : [ id : string ];
    }>();

    //------------------------------------------------------------------------------------------------------------------

    const presentation = computed(() => uploadStatusPresentation(props.item.status));
    const canCancel = computed(() => isActiveStatus(props.item.status));
    const showBar = computed(() => isActiveStatus(props.item.status));

    // A known-byte phase drives a determinate bar; every other active phase animates (null modelValue).
    const barValue = computed<number | null>(() =>
    {
        if(props.item.kind !== 'file') { return null; }

        const { status, progress } = props.item;
        if(progress.totalBytes <= 0) { return null; }

        if(status === 'uploading') { return Math.round((progress.sentBytes / progress.totalBytes) * 100); }
        if(status === 'hashing') { return Math.round((progress.hashedBytes / progress.totalBytes) * 100); }

        return null;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
