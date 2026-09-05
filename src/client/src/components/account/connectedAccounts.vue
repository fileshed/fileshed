<!----------------------------------------------------------------------------------------------------------------------
  -- Connected Accounts
  --
  -- The sign-in methods attached to this account: the email/password credential and any linked OAuth providers.
  -- Connect buttons appear only for providers the running instance actually offers; Connect redirects through the
  -- provider and returns here. Disconnect is refused server-side for the last remaining method, so an account can
  -- never unlink itself out of existence.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-3 rounded-lg border border-default p-4">
        <UAlert
            v-if="error"
            color="error"
            variant="soft"
            title="Couldn't load your sign-in methods."
            :actions="[ { label: 'Retry', color: 'error', variant: 'soft', onClick: () => load() } ]"
        />

        <template v-else>
            <div
                v-for="method of methods"
                :key="method.providerID"
                class="flex items-center justify-between gap-4"
            >
                <div class="flex min-w-0 items-center gap-3">
                    <UIcon :name="method.icon" class="size-5 text-muted" />
                    <div class="min-w-0">
                        <p class="font-medium text-default">
                            {{ method.label }}
                        </p>
                        <p class="text-sm text-muted">
                            {{ method.linked ? 'Connected' : 'Not connected' }}
                        </p>
                    </div>
                </div>

                <UButton
                    v-if="!method.linked"
                    label="Connect"
                    variant="soft"
                    size="sm"
                    :loading="busyProvider === method.providerID"
                    @click="connect(method.providerID)"
                />
                <UButton
                    v-else-if="method.providerID !== 'credential'"
                    label="Disconnect"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :loading="busyProvider === method.providerID"
                    @click="disconnect(method.providerID)"
                />
            </div>

            <p v-if="methods.length === 0" class="text-sm text-muted">
                No sign-in providers are configured on this instance.
            </p>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';

    import { type SocialProviderID, socialProviderIDs } from '@fileshed/core';

    // Resource Access
    import { authClient } from '../../resource-access/authClient.ts';
    import { fetchInstance } from '../../resource-access/instance.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';
    import { providerIcon, providerLabel } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    interface SignInMethod
    {
        providerID : SocialProviderID | 'credential';
        label : string;
        icon : string;
        linked : boolean;
    }

    //------------------------------------------------------------------------------------------------------------------

    const { runMutation } = useRunWithToast();

    // The rows themselves, not just which providers appear in them: unlinking names an account by its own id.
    const linkedAccounts = ref<{ id : string; providerId : string }[]>([]);
    const offeredProviders = ref<SocialProviderID[]>([]);
    const error = ref<Error | null>(null);
    const busyProvider = ref<string | null>(null);

    async function load() : Promise<void>
    {
        error.value = null;

        try
        {
            const [ accounts, instance ] = await Promise.all([ authClient.listAccounts(), fetchInstance() ]);
            if(accounts.error) { throw new Error(accounts.error.message ?? 'Unable to list sign-in methods.'); }

            linkedAccounts.value = (accounts.data ?? [])
                .map((account) => ({ id: account.id, providerId: account.providerId }));
            offeredProviders.value = instance.providers;
        }
        catch(caught)
        {
            error.value = caught instanceof Error ? caught : new Error(String(caught));
        }
    }

    onMounted(() => { void load(); });

    // The credential method shows only when it exists (an OAuth-born account has none); provider rows show when
    // linked OR offered, so a provider the admin later disabled still shows as connected and disconnectable.
    const methods = computed<SignInMethod[]>(() =>
    {
        const rows : SignInMethod[] = [];
        const linkedProviders = linkedAccounts.value.map((account) => account.providerId);

        if(linkedProviders.includes('credential'))
        {
            rows.push({
                providerID: 'credential',
                label: 'Email & password',
                icon: 'i-lucide-key-round',
                linked: true,
            });
        }

        for(const provider of socialProviderIDs)
        {
            const linked = linkedProviders.includes(provider);
            if(linked || offeredProviders.value.includes(provider))
            {
                rows.push({
                    providerID: provider,
                    label: providerLabel(provider),
                    icon: providerIcon(provider),
                    linked,
                });
            }
        }

        return rows;
    });

    function connect(provider : SocialProviderID | 'credential') : void
    {
        if(provider === 'credential') { return; }

        busyProvider.value = provider;
        void runMutation(async () =>
        {
            // Redirects through the provider and back here; the busy flag holds until the navigation happens.
            const { error: linkError } = await authClient.linkSocial({
                provider,
                callbackURL: `${ window.location.origin }/account/account`,
            });
            if(linkError) { throw new Error(linkError.message ?? 'Unable to start the link.'); }
        }, undefined, undefined).finally(() => { busyProvider.value = null; });
    }

    function disconnect(provider : SocialProviderID | 'credential') : void
    {
        busyProvider.value = provider;
        void runMutation(async () =>
        {
            // One row, the way disconnecting one method always worked -- an account holding two identities with the
            // same provider keeps the rest, and the list redraws around what is left.
            const account = linkedAccounts.value.find((linked) => linked.providerId === provider);
            if(account === undefined) { throw new Error('That sign-in method is no longer connected.'); }

            const { error: unlinkError } = await authClient.unlinkAccount({ accountId: account.id });
            if(unlinkError) { throw new Error(unlinkError.message ?? 'Unable to disconnect.'); }

            await load();
        }, undefined, undefined).finally(() => { busyProvider.value = null; });
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
