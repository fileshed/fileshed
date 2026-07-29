<!----------------------------------------------------------------------------------------------------------------------
  -- Logo Field
  --
  -- The instance mark: shown in every sidebar and as the favicon. Upload applies immediately (identity is
  -- per-field like the instance name, not part of the theme draft), Remove returns to the stock mark, and the
  -- preview always shows what visitors currently get.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <BrandingField title="Logo">
        <template #action>
            <UButton
                v-if="app.branding?.logo"
                label="Remove"
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-undo-2"
                class="ms-auto"
                :disabled="pending"
                @click="remove"
            />
        </template>

        <div class="mt-3 flex items-end gap-5">
            <img :src="app.logoUrl" alt="Current logo" class="size-24 shrink-0 rounded-md border border-default p-2">

            <div class="flex flex-col items-start gap-3">
                <p class="text-sm text-muted">
                    Shown in the sidebar and as the favicon. PNG, SVG, JPEG, WebP, GIF, or ICO — square works
                    best.
                </p>
                <UButton
                    :label="app.branding?.logo ? 'Replace…' : 'Upload…'"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-upload"
                    :loading="pending"
                    @click="picker?.click()"
                />
            </div>
            <input
                ref="picker"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon"
                class="hidden"
                @change="upload"
            >
        </div>
    </BrandingField>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';

    // Stores
    import { useAppStore } from '../../../stores/app.ts';

    // Components
    import BrandingField from './brandingField.vue';

    // Resource Access
    import { deleteBrandingLogo, uploadBrandingLogo } from '../../../resource-access/admin.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);
    const picker = ref<HTMLInputElement | null>(null);

    function upload(event : Event) : void
    {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if(file === undefined) { return; }

        void runMutation(async () =>
        {
            await uploadBrandingLogo(file);
            await app.initialize();
        }, pending);
    }

    function remove() : void
    {
        void runMutation(async () =>
        {
            await deleteBrandingLogo();
            await app.initialize();
        }, pending);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
