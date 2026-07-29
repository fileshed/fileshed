<!----------------------------------------------------------------------------------------------------------------------
  -- Remove Provider Modal
  --
  -- Opened imperatively for one provider. Removing deletes every stored override the provider owns in a single
  -- patch -- credentials included, which is why this confirms first. Values that come from the deployment
  -- configuration cannot be deleted from here, and the modal says so instead of pretending.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="`Remove ${ label }?`" :dismissible="!pending">
        <template #body>
            <div class="flex flex-col gap-4">
                <template v-if="overriddenKeys.length > 0">
                    <p class="text-sm text-default">
                        This deletes the stored {{ label }} settings, including its credentials. The provider stops
                        appearing on the sign-in page after the next restart.
                    </p>

                    <div class="flex justify-end gap-2">
                        <UButton
                            color="neutral"
                            variant="ghost"
                            label="Cancel"
                            :disabled="pending"
                            @click="open = false"
                        />
                        <UButton color="error" label="Remove" :loading="pending" @click="onRemove" />
                    </div>
                </template>

                <template v-else>
                    <p class="text-sm text-default">
                        The {{ label }} values come from the deployment configuration, so there is nothing stored
                        here to delete. Remove them from the deployment's environment instead.
                    </p>

                    <div class="flex justify-end">
                        <UButton color="neutral" variant="ghost" label="Close" @click="open = false" />
                    </div>
                </template>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    import { type SocialProviderID, providerOwnedKeys } from '@fileshed/core';

    // Stores
    import { useAdminSettingsStore } from '../../../stores/adminSettings.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';
    import { providerLabel } from '../../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const emit = defineEmits<{ removed : [ provider : SocialProviderID ] }>();

    const { runMutation } = useRunWithToast();
    const settings = useAdminSettingsStore();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<SocialProviderID | null>(null);

    const label = computed(() =>
    {
        return target.value === null ? '' : providerLabel(target.value);
    });

    const overriddenKeys = computed(() =>
    {
        if(target.value === null) { return []; }

        return providerOwnedKeys(target.value).filter((key) =>
            settings.entries.some((entry) => entry.key === key && entry.source === 'override'));
    });

    function openFor(provider : SocialProviderID) : void
    {
        target.value = provider;
        open.value = true;
    }

    function onRemove() : void
    {
        const provider = target.value;
        if(provider === null || overriddenKeys.value.length === 0) { return; }

        void runMutation(async () =>
        {
            await settings.resetAll(overriddenKeys.value);
            emit('removed', provider);
        }, pending, () => { open.value = false; });
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
