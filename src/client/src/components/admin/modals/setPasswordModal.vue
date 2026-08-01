<!----------------------------------------------------------------------------------------------------------------------
  -- Set Password Modal
  --
  -- Opened imperatively for one account: the no-email password reset. The admin sets it and tells the user out of
  -- band; existing sessions survive (signing them out everywhere is its own row action).
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" :title="`Set password for ${ targetName }`" :dismissible="!pending">
        <template #body>
            <div class="flex flex-col gap-4">
                <UFormField label="New password" :help="passwordHelp">
                    <UInput
                        v-model="password"
                        type="text"
                        autocomplete="off"
                        class="w-full"
                        @keydown.enter="onSave"
                    />
                </UFormField>

                <div class="flex justify-end gap-2">
                    <UButton color="neutral" variant="ghost" label="Cancel" :disabled="pending" @click="open = false" />
                    <UButton
                        label="Set password"
                        :loading="pending"
                        :disabled="password.length < PASSWORD_MIN_LENGTH"
                        @click="onSave"
                    />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';

    import { type AdminUserResponse, PASSWORD_MIN_LENGTH } from '@fileshed/core';

    // Resource Access
    import { setUserPassword } from '../../../resource-access/admin.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);
    const target = ref<AdminUserResponse | null>(null);
    const password = ref('');

    const targetName = computed(() => target.value?.name ?? target.value?.email ?? '');

    const passwordHelp = `At least ${ PASSWORD_MIN_LENGTH } characters. Tell the user out of band.`;

    function openFor(user : AdminUserResponse) : void
    {
        target.value = user;
        password.value = '';
        open.value = true;
    }

    function onSave() : void
    {
        const user = target.value;
        if(!user || password.value.length < PASSWORD_MIN_LENGTH) { return; }

        void runMutation(() => setUserPassword(user.id, password.value), pending, () =>
        {
            open.value = false;
        });
    }

    defineExpose({ open: openFor });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
