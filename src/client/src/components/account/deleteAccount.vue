<!----------------------------------------------------------------------------------------------------------------------
  -- Delete Account
  --
  -- The account area's way out. The card names the window rather than promising it can be undone forever: the files
  -- come back if you cancel in time, the reach does not come back at all.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default p-4">
        <h3 class="font-medium text-default">
            Delete my account
        </h3>
        <p class="mt-1 text-sm text-muted">
            Schedules this account and everything in it for deletion in {{ windowLabel }}. Your shares, public links,
            access tokens, and sessions are revoked as soon as you ask; your files wait, and come back if you cancel
            before the date.
        </p>

        <div class="mt-3 flex justify-end">
            <UButton color="error" label="Delete my account" @click="modal?.open()" />
        </div>

        <DeleteAccountModal ref="modal" :window-days="windowDays" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, useTemplateRef } from 'vue';

    import { DEFAULT_ACCOUNT_DELETION_DAYS } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Components
    import DeleteAccountModal from './modals/deleteAccountModal.vue';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const modal = useTemplateRef<{ open : () => void }>('modal');

    // The deployment's own window, not the shipped default -- an instance that moved it must not be described by the
    // number this bundle was built against.
    const windowDays = computed(() => session.me?.limits.accountDeletionDays ?? DEFAULT_ACCOUNT_DELETION_DAYS);
    const windowLabel = computed(() => `${ windowDays.value } day${ windowDays.value === 1 ? '' : 's' }`);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
