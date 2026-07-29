<!----------------------------------------------------------------------------------------------------------------------
  -- Ban User Modal
  --
  -- Opened imperatively for one account. The reason is optional and lands in the row's badge tooltip; the expiry is
  -- whole days, blank meaning the ban holds until an admin lifts it.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="`Ban ${ targetName }`" :dismissible="!pending">
        <template #body>
            <div class="flex flex-col gap-4">
                <UFormField label="Reason" help="Optional; shown to admins, never to the user.">
                    <UInput v-model="reason" class="w-full" :maxlength="500" />
                </UFormField>

                <UFormField label="Expires after (days)" help="Leave blank to ban until lifted.">
                    <UInput
                        v-model="expiresInDays"
                        inputmode="numeric"
                        class="w-full"
                    />
                </UFormField>

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" :disabled="pending" @click="open = false" />
                    <UButton color="error" label="Ban" :loading="pending" @click="onBan" />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    import type { AdminUserResponse, BanUserRequest } from '@fileshed/core';

    // Resource Access
    import { banUser } from '../../../resource-access/admin.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const emit = defineEmits<{ saved : [ user : AdminUserResponse ] }>();

    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<AdminUserResponse | null>(null);
    const reason = ref('');

    // A text input on purpose: UInput type=number emits numbers while its prop typing says string. Plain string
    // draft; validation decides what counts as days.
    const expiresInDays = ref('');

    const targetName = computed(() => target.value?.name ?? target.value?.email ?? '');

    function openFor(user : AdminUserResponse) : void
    {
        target.value = user;
        reason.value = '';
        expiresInDays.value = '';
        open.value = true;
    }

    function onBan() : void
    {
        const user = target.value;
        if(!user) { return; }

        const rawDays = expiresInDays.value.trim();
        const days = Number(rawDays);
        const request : BanUserRequest = {
            ...reason.value.trim() === '' ? {} : { reason: reason.value.trim() },
            ...rawDays === '' || !Number.isInteger(days) ? {} : { expiresInDays: days },
        };

        void runMutation(async () => emit('saved', await banUser(user.id, request)), pending, () =>
        {
            open.value = false;
        });
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
