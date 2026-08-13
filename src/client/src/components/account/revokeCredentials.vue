<!----------------------------------------------------------------------------------------------------------------------
  -- Revoke Credentials
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <h3 class="font-medium text-default">
            Sign out everywhere
        </h3>
        <p class="mt-1 text-sm text-muted">
            End every session, revoke every access token, and cancel any password-reset link already sent, on every
            device and here. Use this if you think someone else has one of your tokens or is signed in as you. If
            your password itself may be known, change it too.
        </p>

        <div class="mt-3 flex justify-end">
            <UButton color="error" label="Sign out everywhere" @click="modal?.open()" />
        </div>

        <RevokeCredentialsModal ref="modal" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { useTemplateRef } from 'vue';

    // Components
    import RevokeCredentialsModal from './modals/revokeCredentialsModal.vue';

    //------------------------------------------------------------------------------------------------------------------

    const modal = useTemplateRef<{ open : () => void }>('modal');
</script>

<!--------------------------------------------------------------------------------------------------------------------->
