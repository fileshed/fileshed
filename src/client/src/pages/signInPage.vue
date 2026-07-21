<!----------------------------------------------------------------------------------------------------------------------
  -- Sign In Page
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <main class="flex min-h-screen items-center justify-center bg-default p-6">
        <UCard class="w-full max-w-sm">
            <template #header>
                <h1 class="text-xl font-bold">
                    {{ app.name }}
                </h1>
                <p class="mt-1 text-sm text-muted">
                    {{ app.tagline }}
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
                        autocomplete="current-password"
                        class="w-full"
                    />
                </UFormField>

                <UButton
                    type="submit"
                    block
                    :loading="session.pending"
                    label="Sign in"
                />
            </UForm>

            <template #footer>
                <p class="text-sm text-muted">
                    Need an account?
                    <RouterLink to="/signup" class="font-medium text-primary">
                        Sign up
                    </RouterLink>
                </p>
            </template>
        </UCard>
    </main>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { reactive, ref } from 'vue';
    import { RouterLink, useRoute, useRouter } from 'vue-router';
    import { z } from 'zod';
    import type { FormSubmitEvent } from '@nuxt/ui';

    // Stores
    import { useAppStore } from '../stores/app.ts';
    import { useSessionStore } from '../stores/session.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Setup
    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const session = useSessionStore();
    const route = useRoute();
    const router = useRouter();

    const schema = z.object({
        email: z.email('Enter a valid email address.'),
        password: z.string().min(1, 'Enter your password.'),
    });

    type SignInFields = z.output<typeof schema>;

    const state = reactive({ email: '', password: '' });
    const errorMessage = ref<string | null>(null);

    //------------------------------------------------------------------------------------------------------------------
    // Submit
    //------------------------------------------------------------------------------------------------------------------

    // Only same-origin absolute paths are honoured, so a crafted ?redirect can't bounce a fresh sign-in off-site.
    function redirectTarget() : string
    {
        const target = route.query.redirect;

        return typeof target === 'string' && target.startsWith('/') ? target : '/';
    }

    async function onSubmit(event : FormSubmitEvent<SignInFields>) : Promise<void>
    {
        errorMessage.value = null;

        try
        {
            await session.signIn(event.data.email, event.data.password);
            await router.push(redirectTarget());
        }
        catch(error)
        {
            errorMessage.value = error instanceof Error ? error.message : 'Something went wrong. Try again.';
        }
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
