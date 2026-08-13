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
                    v-if="arrival && !errorMessage"
                    :color="arrival.color"
                    variant="soft"
                    :description="arrival.description"
                />

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

                <p v-if="emailEnabled" class="text-right text-sm">
                    <RouterLink to="/forgot-password" class="font-medium text-primary">
                        Forgot password?
                    </RouterLink>
                </p>

                <UButton
                    type="submit"
                    block
                    :loading="session.pending"
                    label="Sign in"
                />
            </UForm>

            <div v-if="providers.length > 0" class="mt-4 space-y-3">
                <USeparator label="or" />
                <UButton
                    v-for="provider of providers"
                    :key="provider"
                    block
                    color="neutral"
                    variant="soft"
                    :icon="providerIcon(provider)"
                    :label="`Continue with ${ providerLabel(provider) }`"
                    :loading="socialPending === provider"
                    @click="signInWith(provider)"
                />
            </div>

            <template v-if="signUpEnabled" #footer>
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
    import { computed, onMounted, reactive, ref } from 'vue';
    import { RouterLink, useRoute, useRouter } from 'vue-router';
    import { z } from 'zod';
    import type { FormSubmitEvent } from '@nuxt/ui';

    import type { SocialProviderID } from '@fileshed/core';

    // Stores
    import { useAppStore } from '../stores/app.ts';
    import { useSessionStore } from '../stores/session.ts';

    // Resource Access
    import { authClient } from '../resource-access/authClient.ts';
    import { fetchInstance } from '../resource-access/instance.ts';

    // Utils
    import { providerIcon, providerLabel } from '../utils/formatters/index.ts';

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

    // Optimistically true so the link doesn't pop in on the common (enabled) case.
    const signUpEnabled = ref(true);

    // Off until the instance says mail works: a "Forgot password?" that leads nowhere is worse than none.
    const emailEnabled = ref(false);

    // The provider buttons mirror exactly what the running instance registered at boot.
    const providers = ref<SocialProviderID[]>([]);
    const socialPending = ref<SocialProviderID | null>(null);

    // Why the visitor is looking at sign-in rather than the app. The session kick sends reason=signed-out, which is
    // news to them; the account's own sign-out-everywhere sends reason=revoked, which is the action working and so
    // is not dressed as a warning.
    const arrival = computed<{ description : string; color : 'warning' | 'success' } | null>(() =>
    {
        if(route.query.reason === 'signed-out')
        {
            return {
                description: 'Your session ended — you may have been signed out elsewhere. Sign in to continue.',
                color: 'warning',
            };
        }

        if(route.query.reason === 'revoked')
        {
            return {
                description: 'Every session ended and every access token was revoked. Sign in to continue.',
                color: 'success',
            };
        }

        return null;
    });

    // Only same-origin absolute paths are honoured, so a crafted ?redirect can't bounce a fresh sign-in off-site.
    function redirectTarget() : string
    {
        const target = route.query.redirect;

        return typeof target === 'string' && target.startsWith('/') ? target : '/';
    }

    // A fresh instance has no accounts to sign into -- the visitor belongs at the first-run wizard instead.
    onMounted(async () =>
    {
        try
        {
            const instance = await fetchInstance();
            if(instance.needsSetup) { await router.replace('/setup'); }
            signUpEnabled.value = instance.signUpEnabled;
            emailEnabled.value = instance.emailEnabled;
            providers.value = instance.providers;
        }
        catch { /* an unreachable API leaves sign-in up; submitting will surface the real error */ }
    });

    // The OAuth doorway: better-auth answers a provider URL and the browser leaves; the pending flag holds until
    // the navigation happens. Errors (misconfigured provider) land in the same message slot as a failed password.
    async function signInWith(provider : SocialProviderID) : Promise<void>
    {
        errorMessage.value = null;
        socialPending.value = provider;

        try
        {
            const { error } = await authClient.signIn.social({
                provider,
                callbackURL: `${ window.location.origin }${ redirectTarget() }`,
            });
            if(error) { throw new Error(error.message ?? `Unable to sign in with ${ provider }.`); }
        }
        catch(error)
        {
            errorMessage.value = error instanceof Error ? error.message : 'Something went wrong. Try again.';
            socialPending.value = null;
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Submit
    //------------------------------------------------------------------------------------------------------------------

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
