<!----------------------------------------------------------------------------------------------------------------------
  -- Avatar Edit Modal
  --
  -- Opened imperatively with no argument. A small state machine: pick a source (a FileShed file, a device file, or
  -- remove the current photo), then crop. Both source paths land on the same crop step, whose export is always a fresh
  -- PNG regardless of the source format. The object URL backing the crop preview is revoked on every path out (save,
  -- back, close, or a repeated pick), so browsing never leaks one.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="title" :description="description" :dismissible="!pending">
        <template #body>
            <div v-if="step === 'source'" class="flex flex-col gap-4">
                <div class="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        class="flex cursor-pointer flex-col items-center gap-2.5 rounded-lg border border-default p-6
                            text-sm text-default transition-colors hover:border-accented hover:bg-elevated"
                        @click="step = 'browse'"
                    >
                        <UIcon name="i-lucide-folder" class="size-7 text-primary" />
                        Choose from FileShed
                    </button>
                    <button
                        type="button"
                        class="flex cursor-pointer flex-col items-center gap-2.5 rounded-lg border border-default p-6
                            text-sm text-default transition-colors hover:border-accented hover:bg-elevated"
                        @click="fileInput?.click()"
                    >
                        <UIcon name="i-lucide-upload" class="size-7 text-primary" />
                        Upload from device
                    </button>
                </div>

                <UButton
                    v-if="hasAvatar"
                    color="error"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-trash-2"
                    label="Remove photo"
                    class="self-center"
                    :loading="pending"
                    @click="removeAvatar"
                />

                <input ref="fileInput" type="file" :accept="acceptTypes" class="hidden" @change="onPicked">
            </div>

            <FilePicker
                v-else-if="step === 'browse'"
                :accept="avatarMimeTypes"
                :pending="pending"
                @select="onBrowseSelect"
                @cancel="backToSource"
            />

            <div v-else class="flex flex-col gap-4">
                <Cropper
                    v-if="imageSrc"
                    ref="cropperRef"
                    class="h-80 w-full overflow-hidden rounded-lg bg-elevated"
                    :src="imageSrc"
                    :stencil-component="CircleStencil"
                    :stencil-props="{ aspectRatio: 1 }"
                    :canvas="{ maxWidth: 512, maxHeight: 512 }"
                />

                <div class="flex justify-between gap-2">
                    <UButton color="neutral" variant="ghost" label="Back" :disabled="pending" @click="backToSource" />
                    <UButton color="primary" label="Save" :loading="pending" :disabled="pending" @click="onSave" />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref, watch } from 'vue';
    import { useToast } from '@nuxt/ui/composables';
    import { CircleStencil, Cropper } from 'vue-advanced-cropper';
    import 'vue-advanced-cropper/dist/style.css';

    import { type NodeResponse, avatarMimeTypes } from '@fileshed/core';

    // Stores
    import { useAppStore } from '../../../stores/app.ts';
    import { useSessionStore } from '../../../stores/session.ts';

    // Components
    import FilePicker from '../../drive/filePicker.vue';

    // Resource Access
    import { fetchNodeBlob } from '../../../resource-access/content.ts';

    // Utils
    import { formatBytes } from '../../../utils/formatters/index.ts';
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    type Step = 'source' | 'browse' | 'crop';

    const app = useAppStore();
    const session = useSessionStore();
    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const step = ref<Step>('source');
    const imageSrc = ref<string | null>(null);
    const fileInput = ref<HTMLInputElement | null>(null);
    const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);

    let sourceFile : File | null = null;

    const acceptTypes = avatarMimeTypes.join(',');
    const maxSizeLabel = computed(() => formatBytes(app.avatarMaxBytes));
    const hasAvatar = computed(() => Boolean(session.me?.image));

    const title = computed(() =>
    {
        if(step.value === 'browse') { return 'Choose from FileShed'; }
        if(step.value === 'crop') { return 'Crop photo'; }

        return 'Change avatar';
    });

    const description = computed(() =>
    {
        return step.value === 'source'
            ? `Your photo is cropped to a circle. Max ${ maxSizeLabel.value }.`
            : undefined;
    });

    //------------------------------------------------------------------------------------------------------------------
    // Object-URL lifecycle
    //------------------------------------------------------------------------------------------------------------------

    function revokeImage() : void
    {
        if(imageSrc.value === null) { return; }

        URL.revokeObjectURL(imageSrc.value);
        imageSrc.value = null;
    }

    function setSource(file : File) : void
    {
        revokeImage();
        sourceFile = file;
        imageSrc.value = URL.createObjectURL(file);
        step.value = 'crop';
    }

    // Covers close by Save, Remove, and dismiss (escape/backdrop) alike, since all flip the model through here.
    watch(open, (isOpen) =>
    {
        if(!isOpen) { revokeImage(); }
    });

    function openModal() : void
    {
        revokeImage();
        sourceFile = null;
        step.value = 'source';
        open.value = true;
    }

    function backToSource() : void
    {
        revokeImage();
        sourceFile = null;
        step.value = 'source';
    }

    //------------------------------------------------------------------------------------------------------------------
    // Source: device
    //------------------------------------------------------------------------------------------------------------------

    function onPicked(event : Event) : void
    {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0] ?? null;
        input.value = '';

        if(file === null) { return; }

        if(!(avatarMimeTypes as readonly string[]).includes(file.type))
        {
            toast.add({
                title: 'Unsupported image',
                description: 'Choose a PNG, JPEG, WebP, or GIF image.',
                color: 'error',
            });
            return;
        }

        setSource(file);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Source: FileShed browse
    //------------------------------------------------------------------------------------------------------------------

    function onBrowseSelect(node : NodeResponse) : void
    {
        void runMutation(async () =>
        {
            const blob = await fetchNodeBlob(node.id);
            const type = node.type === 'file' ? node.mimeType : blob.type;
            setSource(new File([ blob ], node.name, { type }));
        }, pending);
    }

    //------------------------------------------------------------------------------------------------------------------
    // Remove
    //------------------------------------------------------------------------------------------------------------------

    function removeAvatar() : void
    {
        void runMutation(() => session.removeAvatar(), pending, () => { open.value = false; });
    }

    //------------------------------------------------------------------------------------------------------------------
    // Crop + save
    //------------------------------------------------------------------------------------------------------------------

    function exportBlob() : Promise<Blob>
    {
        const canvas = cropperRef.value?.getResult().canvas;
        if(!canvas) { return Promise.reject(new Error('Nothing to crop.')); }

        return new Promise((resolve, reject) =>
        {
            canvas.toBlob((blob) =>
            {
                if(blob === null) { reject(new Error('Unable to export the cropped image.')); return; }
                resolve(blob);
            }, 'image/png');
        });
    }

    function croppedFileName() : string
    {
        const base = (sourceFile?.name ?? 'avatar').replace(/\.[^./]+$/, '');
        return `${ base }.png`;
    }

    function onSave() : void
    {
        void runMutation(async () =>
        {
            const blob = await exportBlob();
            const file = new File([ blob ], croppedFileName(), { type: 'image/png' });
            await session.saveAvatar(file);
        }, pending, () => { open.value = false; });
    }

    defineExpose({ open: openModal });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
