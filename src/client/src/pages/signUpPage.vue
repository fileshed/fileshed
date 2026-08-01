<!----------------------------------------------------------------------------------------------------------------------
  -- Sign Up Page
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <main class="flex min-h-screen items-center justify-center bg-default p-6">
        <UCard class="w-full max-w-sm">
            <template #header>
                <h1 class="text-xl font-bold">
                    {{ app.name }}
                </h1>
                <p class="mt-1 text-sm text-muted">
                    Create your account.
                </p>
            </template>

            <UForm
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

                <UFormField label="Name" name="name">
                    <UInput
                        v-model="state.name"
                        autocomplete="name"
                        class="w-full"
                    />
                </UFormField>

                <UFormField label="Email" name="email">
                    <UInput
                        v-model="state.email"
                        type="email"
                        autocomplete="email"
                        class="w-full"
                    />
                </UFormField>

                <UFormField label="Password" name="password">
                    <UInput
                        v-model="state.password"
                        type="password"
                        autocomplete="new-password"
                        class="w-full"
                    />
                </UFormField>

                <UButton
                    type="submit"
                    block
                    :loading="session.pending"
                    label="Create account"
                />
            </UForm>

            <template #footer>
                <p class="text-sm text-muted">
                    Already have an account?
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
    import { onMounted, reactive, ref } from 'vue';
    import { RouterLink, useRouter } from 'vue-router';
    import { z } from 'zod';
    import type { FormSubmitEvent } from '@nuxt/ui';

    import { PASSWORD_MIN_LENGTH } from '@fileshed/core';

    // Stores
    import { useAppStore } from '../stores/app.ts';
    import { useSessionStore } from '../stores/session.ts';

    // Resource Access
    import { fetchInstance } from '../resource-access/instance.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Setup
    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const session = useSessionStore();
    const router = useRouter();

    const schema = z.object({
        name: z.string().min(1, 'Enter your name.'),
        email: z.email('Enter a valid email address.'),
        password: z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${ PASSWORD_MIN_LENGTH } characters.`),
    });

    type SignUpFields = z.output<typeof schema>;

    const state = reactive({ name: '', email: '', password: '' });
    const errorMessage = ref<string | null>(null);

    // An instance with sign-ups switched off has no business showing this form; the server would refuse the
    // submission anyway, so bounce to sign-in rather than let anyone fill it out for nothing.
    onMounted(async () =>
    {
        try
        {
            const instance = await fetchInstance();
            if(!instance.signUpEnabled) { await router.replace('/signin'); }
        }
        catch { /* an unreachable API leaves the form up; submitting will surface the real error */ }
    });

    //------------------------------------------------------------------------------------------------------------------
    // Submit
    //------------------------------------------------------------------------------------------------------------------

    async function onSubmit(event : FormSubmitEvent<SignUpFields>) : Promise<void>
    {
        errorMessage.value = null;

        try
        {
            await session.signUp(event.data.name, event.data.email, event.data.password);
            await router.push({ path: '/' });
        }
        catch(error)
        {
            errorMessage.value = error instanceof Error ? error.message : 'Something went wrong. Try again.';
        }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
