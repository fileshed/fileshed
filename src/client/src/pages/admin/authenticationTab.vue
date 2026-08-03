<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Authentication Tab
  --
  -- Social sign-in over better-auth's full provider list, uncurated: nothing renders until an admin adds a
  -- provider, and a provider with any stored value keeps its card on every visit. Each card mounts the
  -- providerFields wrapper, which knows whether the provider needs more than a credential pair, and spells out
  -- the callback URL the provider's OAuth app must whitelist -- the step everyone forgets. Removing a card with
  -- anything stored behind it goes through a confirming modal; an empty one just closes. Every knob here is
  -- restart-flagged: better-auth registers the OAuth routes at boot.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-8">
        <RestartBanner />

        <UAlert
            v-if="settings.error"
            color="error"
            variant="soft"
            title="Couldn't load the instance settings."
            :actions="[ { label: 'Retry', color: 'error', variant: 'soft', onClick: () => settings.load() } ]"
        />

        <template v-else>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <p class="text-sm text-muted">
                    Sign-in providers take effect after a restart. FileShed offers every provider better-auth
                    supports.
                </p>
                <USelectMenu
                    v-model="providerToAdd"
                    :items="addableProviders"
                    value-key="value"
                    placeholder="Add provider…"
                    icon="i-lucide-plus"
                    class="sm:w-56 sm:shrink-0"
                />
            </div>

            <UCard v-for="provider of shownProviders" :key="provider">
                <template #header>
                    <div class="flex items-center gap-2">
                        <UIcon :name="providerIcon(provider)" class="size-5 text-muted" />
                        <h2 class="text-lg font-semibold text-highlighted">
                            {{ providerLabel(provider) }}
                        </h2>
                        <UButton
                            class="ms-auto"
                            icon="i-lucide-trash-2"
                            color="neutral"
                            variant="ghost"
                            :aria-label="`Remove ${ providerLabel(provider) }`"
                            @click="removeProvider(provider)"
                        />
                    </div>
                </template>

                <div class="flex flex-col gap-3">
                    <p v-if="providerConsoleURL(provider)" class="text-sm text-muted">
                        Get your credentials from the
                        <a
                            :href="providerConsoleURL(provider) ?? undefined"
                            target="_blank"
                            rel="noopener"
                            class="text-primary hover:underline"
                        >{{ providerLabel(provider) }} developer console</a>.
                    </p>
                    <p class="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                        Callback URL for the OAuth app:
                        <code class="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs break-all">{{
                            callbackURL(provider) }}</code>
                        <UButton
                            icon="i-lucide-copy"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            :aria-label="`Copy the ${ providerLabel(provider) } callback URL`"
                            @click="copyCallback(provider)"
                        />
                    </p>
                    <ProviderFields :provider="provider" />
                </div>
            </UCard>

            <p v-if="shownProviders.length === 0" class="text-sm text-muted">
                No sign-in providers configured. Pick one from "Add provider" to begin.
            </p>
        </template>

        <RemoveProviderModal ref="removeModal" @removed="dropFromVisit" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, nextTick, onMounted, ref, watch } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import {
        type SocialProviderID,
        providerOwnedKeys,
        providerRequiredKeys,
        socialProviderIDs,
    } from '@fileshed/core';

    // Stores
    import { useAdminSettingsStore } from '../../stores/adminSettings.ts';

    // Components
    import RestartBanner from '../../components/admin/restartBanner.vue';
    import ProviderFields from '../../components/admin/providers/providerFields.vue';
    import RemoveProviderModal from '../../components/admin/modals/removeProviderModal.vue';

    // Utils
    import { copyToClipboard } from '../../utils/copyToClipboard.ts';
    import { providerConsoleURL, providerIcon, providerLabel } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Data
    //------------------------------------------------------------------------------------------------------------------

    const settings = useAdminSettingsStore();
    const toast = useToast();

    onMounted(() => { void settings.load(); });

    // Providers the admin opened this visit but has not saved anything for yet -- they render so the fields can be
    // filled, and become "configured" the moment any value lands.
    const addedThisVisit = ref<SocialProviderID[]>([]);
    const providerToAdd = ref<SocialProviderID | undefined>(undefined);

    // A provider is configured when any of the keys its activation reads holds a value.
    const configuredProviders = computed(() => socialProviderIDs.filter((provider) =>
        providerRequiredKeys(provider).some((key) =>
            settings.entries.some((entry) => entry.key === key && entry.value !== null))));

    const shownProviders = computed(() => socialProviderIDs.filter((provider) =>
        configuredProviders.value.includes(provider) || addedThisVisit.value.includes(provider)));

    const addableProviders = computed(() => socialProviderIDs
        .filter((provider) => !shownProviders.value.includes(provider))
        .map((provider) => ({ label: providerLabel(provider), value: provider, icon: providerIcon(provider) })));

    watch(providerToAdd, (provider) =>
    {
        if(provider === undefined) { return; }

        addedThisVisit.value = [ ...addedThisVisit.value, provider ];

        // Deferred a tick: resetting synchronously lands in the same flush as the menu's own update, so the menu
        // never observes the prop change and keeps displaying the pick.
        void nextTick(() => { providerToAdd.value = undefined; });
    });

    function callbackURL(provider : SocialProviderID) : string
    {
        return `${ window.location.origin }/api/auth/callback/${ provider }`;
    }

    async function copyCallback(provider : SocialProviderID) : Promise<void>
    {
        const url = callbackURL(provider);

        if(await copyToClipboard(url))
        {
            toast.add({ title: 'Callback URL copied', description: url, color: 'success' });
        }
        else
        {
            toast.add({
                title: 'Couldn\'t copy the URL',
                description: 'Copy it from the field instead.',
                color: 'error',
            });
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Removal
    //------------------------------------------------------------------------------------------------------------------

    const removeModal = ref<InstanceType<typeof RemoveProviderModal> | null>(null);

    function dropFromVisit(provider : SocialProviderID) : void
    {
        addedThisVisit.value = addedThisVisit.value.filter((candidate) => candidate !== provider);
    }

    // Anything stored -- an admin override or a deployment-config value -- means the modal decides; only a group
    // opened this visit with nothing behind it vanishes without ceremony.
    function removeProvider(provider : SocialProviderID) : void
    {
        const anythingStored = providerOwnedKeys(provider).some((key) =>
            settings.entries.some((entry) => entry.key === key && entry.value !== null));

        if(anythingStored) { removeModal.value?.open(provider); return; }

        dropFromVisit(provider);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
