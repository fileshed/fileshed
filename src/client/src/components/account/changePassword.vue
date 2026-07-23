<!----------------------------------------------------------------------------------------------------------------------
  -- Change Password
  --
  -- The account-page control for changing the sign-in password. The confirm field must match the new password before
  -- Update is live -- the only client-side gate; the server still enforces the current password and any strength rules.
  -- The optional "sign out everywhere else" opt-in defaults off. A success clears the fields and toasts; a failure keeps
  -- them, so the user can correct a mistyped current password without retyping the rest.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <h3 class="font-medium text-default">
            Change password
        </h3>
        <p class="mt-1 text-sm text-muted">
            Update the password you use to sign in.
        </p>

        <div class="mt-3 flex max-w-md flex-col gap-3">
            <UFormField label="Current password">
                <UInput
                    v-model="current"
                    type="password"
                    autocomplete="current-password"
                    class="w-full"
                />
            </UFormField>

            <UFormField label="New password">
                <UInput
                    v-model="next"
                    type="password"
                    autocomplete="new-password"
                    class="w-full"
                />
            </UFormField>

            <UFormField
                label="Confirm new password"
                :error="mismatch ? 'Passwords do not match.' : undefined"
            >
                <UInput
                    v-model="confirm"
                    type="password"
                    autocomplete="new-password"
                    class="w-full"
                />
            </UFormField>

            <UCheckbox v-model="revokeOthers" label="Sign out of all other sessions" />

            <div class="flex justify-end">
                <UButton label="Update password" :loading="pending" :disabled="!canSubmit" @click="submit" />
            </div>
        </div>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);
    const current = ref('');
    const next = ref('');
    const confirm = ref('');
    const revokeOthers = ref(false);

    // Surface the mismatch only once the user has typed a confirmation, so an empty field doesn't read as an error.
    const mismatch = computed(() => confirm.value !== '' && confirm.value !== next.value);

    const canSubmit = computed(() =>
        current.value !== '' && next.value !== '' && confirm.value === next.value);

    function submit() : void
    {
        if(!canSubmit.value) { return; }

        void runMutation(
            () => session.changePassword(current.value, next.value, revokeOthers.value),
            pending,
            () =>
            {
                current.value = '';
                next.value = '';
                confirm.value = '';
                revokeOthers.value = false;
                toast.add({ title: 'Password changed', color: 'success' });
            }
        );
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
