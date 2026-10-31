<!----------------------------------------------------------------------------------------------------------------------
  -- Delete Account Modal
  --
  -- Two things have to be clear before the click, because they happen at different times and only one of them is
  -- reversible: the files wait out the window and come back if the user changes their mind, while the shares, links,
  -- and tokens are gone the moment they ask and stay gone.
  --
  -- Every session ends with the request, this one included, so the signed-in state is dropped before navigating to
  -- /signin; otherwise the auth guard would bounce a visitor it still thinks is signed in. /signin says why, the same
  -- way revoke-everywhere does.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <UModal v-model:open="open" title="Delete my account" :dismissible="!pending">
        <template #body>
            <div class="space-y-4">
                <p>
                    Your account is deleted after {{ windowLabel }}, along with every file and folder you own. Until
                    then nothing is lost: sign in and cancel, and your files and settings are exactly as you left
                    them.
                </p>
                <p>
                    Right away, though, everything you have shared out stops working. Every share you granted is
                    revoked, every public link you published goes dead, and every access token stops working. Every
                    session ends too, including this one, so you will be signed out here.
                </p>
                <p class="font-medium">
                    Cancelling brings your account back. It does not bring those back.
                </p>

                <div class="flex justify-end gap-2">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        label="Keep my account"
                        :disabled="pending"
                        @click="open = false"
                    />
                    <UButton
                        color="error"
                        label="Delete my account"
                        aria-label="Confirm account deletion"
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
    import { computed, ref } from 'vue';
    import { useRouter } from 'vue-router';

    // Stores
    import { useSessionStore } from '../../../stores/session.ts';

    // Resource Access
    import { requestAccountDeletion } from '../../../resource-access/me.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{ windowDays : number }>();

    const router = useRouter();
    const session = useSessionStore();
    const { runMutation } = useRunWithToast();

    const open = ref(false);
    const pending = ref(false);

    const windowLabel = computed(() => `${ props.windowDays } day${ props.windowDays === 1 ? '' : 's' }`);

    //------------------------------------------------------------------------------------------------------------------

    function show() : void
    {
        open.value = true;
    }

    function confirm() : void
    {
        void runMutation(async () => { await requestAccountDeletion(); }, pending, () =>
        {
            open.value = false;
            session.clearSession();
            void router.replace({ path: '/signin', query: { reason: 'deletion-requested' } });
        });
    }

    defineExpose({ open: show });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
