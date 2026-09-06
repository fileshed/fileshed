<!----------------------------------------------------------------------------------------------------------------------
  -- Delete User Modal
  --
  -- Opened imperatively for one account. Everything it lists is gone the moment this is confirmed -- there is no
  -- trash behind it and no window to change your mind in -- so the account's email has to be typed back before the
  -- button will do anything.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="`Delete ${ targetName }`" :dismissible="!pending">
        <template #body>
            <div class="flex flex-col gap-4">
                <p>
                    This deletes the account and everything it holds. It can't be undone.
                </p>

                <ul class="list-disc space-y-1 pl-5 text-sm text-muted">
                    <li>Every file and folder they own is permanently deleted, trash included.</li>
                    <li>The storage behind those files is released, unless another account holds the same file.</li>
                    <li>Their avatar, access tokens, and sessions go with them.</li>
                    <li>Every share they granted is revoked.</li>
                </ul>

                <UFormField label="Type the account's email to confirm">
                    <UInput
                        v-model="typed"
                        class="w-full"
                        autocomplete="off"
                        :placeholder="targetEmail"
                    />
                </UFormField>

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" :disabled="pending" @click="open = false" />
                    <UButton
                        color="error"
                        label="Delete account"
                        :disabled="!confirmed"
                        :loading="pending"
                        @click="onDelete"
                    />
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
    import { deleteUser } from '../../../resource-access/admin.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const emit = defineEmits<{ deleted : [ user : AdminUserResponse ] }>();

    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<AdminUserResponse | null>(null);
    const typed = ref('');

    const targetEmail = computed(() => target.value?.email ?? '');
    const targetName = computed(() => target.value?.name ?? targetEmail.value);

    // Case and surrounding space are not the point; typing the wrong account's address is.
    const confirmed = computed(() =>
    {
        return typed.value.trim().toLowerCase() === targetEmail.value.toLowerCase() && targetEmail.value !== '';
    });

    function openFor(user : AdminUserResponse) : void
    {
        target.value = user;
        typed.value = '';
        open.value = true;
    }

    function onDelete() : void
    {
        const user = target.value;
        if(!user || !confirmed.value) { return; }

        void runMutation(() => deleteUser(user.id), pending, () =>
        {
            open.value = false;
            emit('deleted', user);
        });
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
