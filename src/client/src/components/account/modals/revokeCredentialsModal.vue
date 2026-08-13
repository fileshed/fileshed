<!----------------------------------------------------------------------------------------------------------------------
  -- Revoke Credentials Modal
  --
  -- The confirm behind "Sign out everywhere". It spells out every consequence before the click, because none is
  -- recoverable: sessions have to be signed back into, revoked tokens can only be replaced with new ones, and a
  -- cancelled reset link has to be requested again. The last one is the one a user can be caught by -- they may be
  -- waiting on a link they asked for from another device -- so it is named here rather than only on the card. On
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
                <p>
                    Any password-reset link you have already been sent stops working. If you are waiting on one,
                    you will need to request it again.
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
