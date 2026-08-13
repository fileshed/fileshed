<!----------------------------------------------------------------------------------------------------------------------
  -- Revoke Credentials Modal
  --
  -- The confirm behind "Sign out everywhere". It spells out both halves before the click, because neither is
  -- recoverable: sessions have to be signed back into, and revoked tokens can only be replaced with new ones. On
  -- success the signed-in state is dropped BEFORE the navigation, so the auth guard sees an anonymous visitor and
  -- lets /signin through, where the reason=revoked notice is what confirms the action landed. A failure leaves the
  -- dialog open to toast under, and the session is still alive to retry with.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Sign out everywhere" :dismissible="!pending">
        <template #body>
            <div class="space-y-4">
                <p>
                    Every session ends, on every device, including this one. You will be signed out here and will
                    need to sign in again.
                </p>
                <p>
                    Every access token stops working. Scripts, sync tools, and media players using one will fail
                    until you create new tokens.
                </p>

                <div class="flex justify-end gap-2">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        label="Cancel"
                        :disabled="pending"
                        @click="open = false"
                    />
                    <UButton
                        color="error"
                        label="Sign out everywhere"
                        aria-label="Confirm sign out everywhere"
                        :loading="pending"
                        @click="confirm"
                    />
                </div>
            </div>
        </template>
    </UModal>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { ref } from 'vue';
    import { useRouter } from 'vue-router';

    // Stores
    import { useSessionStore } from '../../../stores/session.ts';

    // Resource Access
    import { revokeAllCredentials } from '../../../resource-access/credentials.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const router = useRouter();
    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);

    //------------------------------------------------------------------------------------------------------------------

    function show() : void
    {
        open.value = true;
    }

    function confirm() : void
    {
        void runMutation(revokeAllCredentials, pending, () =>
        {
            open.value = false;
            session.clearSession();
            void router.replace({ path: '/signin', query: { reason: 'revoked' } });
        });
    }

    defineExpose({ open: show });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
