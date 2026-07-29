<!----------------------------------------------------------------------------------------------------------------------
  -- Forgot Password Page
  --
  -- The email-side reset entry: one address field, and the same confirmation whether the address exists or not --
  -- this page must never be an account oracle. The emailed link lands on /reset-password with the token.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <main class="flex min-h-screen items-center justify-center bg-default p-6">
        <UCard class="w-full max-w-sm">
            <template #header>
                <h1 class="text-xl font-bold">
                    {{ app.name }}
                </h1>
                <p class="mt-1 text-sm text-muted">
                    Reset your password.
                </p>
            </template>

            <div v-if="requested" class="space-y-4">
                <UAlert
                    color="success"
                    variant="soft"
                    description="If that address has an account, a reset link is on its way. The link is good for
                        one hour."
                />
                <p class="text-sm text-muted">
                    <RouterLink to="/signin" class="font-medium text-primary">
                        Back to sign in
                    </RouterLink>
                </p>
            </div>

            <UForm
                v-else
                :schema="schema"
                :state="state"
                class="space-y-4"
                @submit="onSubmit"
            >
                <UAlert
                    v-if="errorMessage"
                    color="error"
                    variant="soft"
                    :description="errorMessage"
                />

                <UFormField label="Email" name="email">
                    <UInput
                        v-model="state.email"
                        type="email"
                        autocomplete="email"
                        class="w-full"
                    />
                </UFormField>

                <UButton
                    type="submit"
                    block
                    :loading="pending"
                    label="Send reset link"
                />
            </UForm>

            <template v-if="!requested" #footer>
                <p class="text-sm text-muted">
                    Remembered it?
                    <RouterLink to="/signin" class="font-medium text-primary">
                        Sign in
                    </RouterLink>
                </p>
            </template>
        </UCard>
    </main>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { reactive, ref } from 'vue';
    import { RouterLink } from 'vue-router';
    import { z } from 'zod';
    import type { FormSubmitEvent } from '@nuxt/ui';

    // Stores
    import { useAppStore } from '../stores/app.ts';

    // Resource Access
    import { authClient } from '../resource-access/authClient.ts';

    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();

    const schema = z.object({
        email: z.email('Enter a valid email address.'),
    });

    type ForgotFields = z.output<typeof schema>;

    const state = reactive({ email: '' });
    const pending = ref(false);
    const requested = ref(false);
    const errorMessage = ref<string | null>(null);

    async function onSubmit(event : FormSubmitEvent<ForgotFields>) : Promise<void>
    {
        errorMessage.value = null;
        pending.value = true;

        try
        {
            const { error } = await authClient.requestPasswordReset({
                email: event.data.email,
                redirectTo: `${ window.location.origin }/reset-password`,
            });
            if(error) { throw new Error(error.message ?? 'Something went wrong. Try again.'); }

            requested.value = true;
        }
        catch(error)
        {
            errorMessage.value = error instanceof Error ? error.message : 'Something went wrong. Try again.';
        }
        finally
        {
            pending.value = false;
        }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
