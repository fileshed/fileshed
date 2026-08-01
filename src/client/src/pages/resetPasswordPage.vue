<!----------------------------------------------------------------------------------------------------------------------
  -- Reset Password Page
  --
  -- Where the emailed link lands: better-auth redirects here with ?token= when the link is good, or
  -- ?error=INVALID_TOKEN when it is expired or already used. A successful reset revokes every other session
  -- server-side, so the fresh sign-in is the only way back in.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <main class="flex min-h-screen items-center justify-center bg-default p-6">
        <UCard class="w-full max-w-sm">
            <template #header>
                <h1 class="text-xl font-bold">
                    {{ app.name }}
                </h1>
                <p class="mt-1 text-sm text-muted">
                    Choose a new password.
                </p>
            </template>

            <div v-if="!token || linkError" class="space-y-4">
                <UAlert
                    color="error"
                    variant="soft"
                    description="This reset link is invalid or has expired. Request a fresh one and use it within
                        an hour."
                />
                <p class="text-sm text-muted">
                    <RouterLink to="/forgot-password" class="font-medium text-primary">
                        Request a new link
                    </RouterLink>
                </p>
            </div>

            <div v-else-if="done" class="space-y-4">
                <UAlert
                    color="success"
                    variant="soft"
                    description="Your password is changed and every other session is signed out. Sign in with the
                        new one."
                />
                <p class="text-sm text-muted">
                    <RouterLink to="/signin" class="font-medium text-primary">
                        Go to sign in
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

                <UFormField label="New password" name="password">
                    <UInput
                        v-model="state.password"
                        type="password"
                        autocomplete="new-password"
                        class="w-full"
                    />
                </UFormField>

                <UFormField label="Confirm new password" name="confirm">
                    <UInput
                        v-model="state.confirm"
                        type="password"
                        autocomplete="new-password"
                        class="w-full"
                    />
                </UFormField>

                <UButton
                    type="submit"
                    block
                    :loading="pending"
                    label="Set new password"
                />
            </UForm>
        </UCard>
    </main>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, reactive, ref } from 'vue';
    import { RouterLink, useRoute } from 'vue-router';
    import { z } from 'zod';
    import type { FormSubmitEvent } from '@nuxt/ui';

    import { PASSWORD_MIN_LENGTH } from '@fileshed/core';

    // Stores
    import { useAppStore } from '../stores/app.ts';

    // Resource Access
    import { authClient } from '../resource-access/authClient.ts';

    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const route = useRoute();

    const token = computed(() =>
    {
        return typeof route.query.token === 'string' ? route.query.token : null;
    });
    const linkError = computed(() => typeof route.query.error === 'string');

    const schema = z
        .object({
            password: z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${ PASSWORD_MIN_LENGTH } characters.`),
            confirm: z.string(),
        })
        .refine((fields) => fields.password === fields.confirm, {
            message: 'Passwords do not match.',
            path: [ 'confirm' ],
        });

    type ResetFields = z.output<typeof schema>;

    const state = reactive({ password: '', confirm: '' });
    const pending = ref(false);
    const done = ref(false);
    const errorMessage = ref<string | null>(null);

    async function onSubmit(event : FormSubmitEvent<ResetFields>) : Promise<void>
    {
        if(token.value === null) { return; }

        errorMessage.value = null;
        pending.value = true;

        try
        {
            const { error } = await authClient.resetPassword({
                newPassword: event.data.password,
                token: token.value,
            });
            if(error) { throw new Error(error.message ?? 'Unable to reset the password. Try a fresh link.'); }

            done.value = true;
        }
        catch(error)
        {
            errorMessage.value = error instanceof Error
                ? error.message
                : 'Unable to reset the password. Try a fresh link.';
        }
        finally
        {
            pending.value = false;
        }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
