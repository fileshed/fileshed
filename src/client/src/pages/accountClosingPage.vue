<!----------------------------------------------------------------------------------------------------------------------
  -- Account Closing Page
  --
  -- Where an account that has asked to be deleted lands, and the only page it can reach. The server refuses it
  -- everywhere else, so this exists to say when the account goes and to offer the one action still open: calling it
  -- off.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <main class="flex min-h-screen items-center justify-center bg-default p-6">
        <UCard class="w-full max-w-md">
            <template #header>
                <h1 class="text-xl font-bold">
                    This account is scheduled for deletion
                </h1>
            </template>

            <div class="flex flex-col gap-4">
                <p class="text-default">
                    Everything in <span class="font-medium">{{ session.me?.email }}</span> will be permanently deleted
                    on <span class="font-medium">{{ scheduledFor }}</span>. Until then, nothing here can be used.
                </p>

                <p class="text-sm text-muted">
                    Your files and folders are untouched and come back if you cancel. The shares you had granted, the
                    public links you had published, and your access tokens were revoked when you asked, and cancelling
                    does not bring those back.
                </p>

                <div class="flex justify-end gap-2">
                    <UButton
                        color="neutral"
                        variant="ghost"
                        label="Sign out"
                        :disabled="pending"
                        @click="signOut"
                    />
                    <UButton label="Keep my account" :loading="pending" @click="keepAccount" />
                </div>
            </div>
        </UCard>
    </main>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, ref } from 'vue';
    import { useRouter } from 'vue-router';
    import { useToast } from '@nuxt/ui/composables';

    // Stores
    import { useSessionStore } from '../stores/session.ts';

    // Resource Access
    import { cancelAccountDeletion } from '../resource-access/me.ts';

    // Utils
    import { useRunWithToast } from '../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const router = useRouter();
    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const pending = ref(false);

    // The full date rather than "in 29 days": this is the one number that matters, and a countdown invites arithmetic
    // nobody should have to do about their own files.
    const scheduledFor = computed(() =>
    {
        const iso = session.me?.deletion?.scheduledFor;
        if(iso === undefined) { return ''; }

        return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
    });

    function keepAccount() : void
    {
        void runMutation(async () => { session.me = await cancelAccountDeletion(); }, pending, () =>
        {
            toast.add({ title: 'Your account is staying.', color: 'success' });
            void router.push('/');
        });
    }

    function signOut() : void
    {
        void session.signOut();
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
