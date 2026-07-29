<!----------------------------------------------------------------------------------------------------------------------
  -- Set Quota Modal
  --
  -- Opened imperatively for one account. The field prefills with the current cap in bytes; clearing it saves
  -- Unlimited (null), which is also what the placeholder promises.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="`Quota for ${ targetName }`" :dismissible="!pending">
        <template #body>
            <div class="flex flex-col gap-4">
                <UFormField label="Size cap" help="A size like 20gb or 500mb, raw bytes, or blank for unlimited.">
                    <UInput
                        v-model="draft"
                        inputmode="numeric"
                        placeholder="Unlimited"
                        class="w-full"
                        @keydown.enter="onSave"
                    />
                    <p v-if="draftBytes !== null" class="mt-1 text-xs text-muted">
                        = {{ describeByteSize(draftBytes) }} ({{ formatBytes(draftBytes) }})
                    </p>
                </UFormField>

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" :disabled="pending" @click="open = false" />
                    <UButton label="Save" :loading="pending" :disabled="!valid" @click="onSave" />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    import type { AdminUserResponse } from '@fileshed/core';

    // Resource Access
    import { setQuota } from '../../../resource-access/admin.ts';

    // Engines
    import { describeByteSize, parseByteSize } from '../../../engines/byteSize.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';
    import { formatBytes } from '../../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const emit = defineEmits<{ saved : [ user : AdminUserResponse ] }>();

    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<AdminUserResponse | null>(null);

    // A text input on purpose: UInput type=number emits numbers while its prop typing says string. Plain string
    // draft; validation decides what counts as a cap.
    const draft = ref('');

    const targetName = computed(() => target.value?.name ?? target.value?.email ?? '');

    // The draft as a storable cap: null for a blank field (unlimited) or while it isn't a parseable size --
    // human units ("20gb", "500mb") or raw bytes.
    const draftBytes = computed<number | null>(() => parseByteSize(draft.value));

    const valid = computed(() => draft.value.trim() === '' || draftBytes.value !== null);

    function openFor(user : AdminUserResponse) : void
    {
        target.value = user;
        draft.value = user.quotaLimit === null ? '' : String(user.quotaLimit);
        open.value = true;
    }

    function onSave() : void
    {
        const user = target.value;
        if(!user || !valid.value) { return; }

        void runMutation(async () => emit('saved', await setQuota(user.id, draftBytes.value)), pending, () =>
        {
            open.value = false;
        });
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
