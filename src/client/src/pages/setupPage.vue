<!----------------------------------------------------------------------------------------------------------------------
  -- Setup Page
  --
  -- The first-run wizard: create the instance's admin account, gated by the one-time code the server printed to its
  -- console. Success signs the new admin straight in and lands them in the admin section to configure the rest. On
  -- an instance that is already set up this page bounces to sign-in -- the server would refuse anyway; the bounce
  -- just spares the visitor a dead form.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <main class="flex min-h-screen items-center justify-center bg-default p-6">
        <UCard class="w-full max-w-sm">
            <template #header>
                <h1 class="text-xl font-bold">
                    Welcome to {{ app.name }}
                </h1>
                <p class="mt-1 text-sm text-muted">
                    First-run setup: create the admin account. The setup code is printed in the server's console
                    log, freshly generated on every start.
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

                <UFormField label="Setup code" name="token">
                    <UInput
                        v-model="state.token"
                        autocomplete="off"
                        placeholder="7f3a-c9d2-04b1-88ee"
                        class="w-full font-mono"
                    />
                </UFormField>

                <UFormField label="Your name" name="name">
                    <UInput v-model="state.name" autocomplete="name" class="w-full" />
                </UFormField>

                <UFormField label="Email" name="email">
                    <UInput v-model="state.email" type="email" autocomplete="email" class="w-full" />
                </UFormField>

                <UFormField label="Password" name="password">
                    <UInput
                        v-model="state.password"
                        type="password"
                        autocomplete="new-password"
                        class="w-full"
                    />
                </UFormField>

                <UFormField label="Confirm password" name="confirm">
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
                    label="Create admin account"
                />
            </UForm>
        </UCard>
    </main>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, reactive, ref } from 'vue';
    import { useRouter } from 'vue-router';
    import { z } from 'zod';
    import type { FormSubmitEvent } from '@nuxt/ui';

    // Stores
    import { useAppStore } from '../stores/app.ts';
    import { useSessionStore } from '../stores/session.ts';

    // Resource Access
    import { completeSetup, fetchInstance } from '../resource-access/instance.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Setup
    //------------------------------------------------------------------------------------------------------------------

    const app = useAppStore();
    const session = useSessionStore();
    const router = useRouter();

    const schema = z.object({
        token: z.string().min(1, 'Enter the setup code from the server log.'),
        name: z.string().min(1, 'Enter your name.'),
        email: z.email('Enter a valid email address.'),
        password: z.string().min(8, 'At least 8 characters.'),
        confirm: z.string(),
    }).refine((fields) => fields.confirm === fields.password, {
        path: [ 'confirm' ],
        message: 'Passwords do not match.',
    });

    type SetupFields = z.output<typeof schema>;

    const state = reactive({ token: '', name: '', email: '', password: '', confirm: '' });
    const pending = ref(false);
    const errorMessage = ref<string | null>(null);

    onMounted(async () =>
    {
        try
        {
            const instance = await fetchInstance();
            if(!instance.needsSetup) { await router.replace('/signin'); }
        }
        catch { /* an unreachable API leaves the form up; submitting will surface the real error */ }
    });

    //------------------------------------------------------------------------------------------------------------------
    // Submit
    //------------------------------------------------------------------------------------------------------------------

    async function onSubmit(event : FormSubmitEvent<SetupFields>) : Promise<void>
    {
        errorMessage.value = null;
        pending.value = true;

        try
        {
            await completeSetup({
                token: event.data.token.trim(),
                name: event.data.name,
                email: event.data.email,
                password: event.data.password,
            });

            // The account exists; sign it in with the same credentials and land in the admin section.
            await session.signIn(event.data.email, event.data.password);
            await router.push('/admin');
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
