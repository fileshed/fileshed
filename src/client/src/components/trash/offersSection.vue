<!----------------------------------------------------------------------------------------------------------------------
  -- Offered To You
  --
  -- The offeree's surface of the recipients-may-copy flow: when the owner of a file shared with you hard-deletes it and
  -- opts to let recipients keep a copy, a time-boxed offer lands here. Saving a copy places a fresh file you own in My
  -- Files, referencing the same content, charged to your quota; declining lets the offer lapse. The offer carries a
  -- snapshot of the deleted file (the node is already gone), so nothing here needs to resolve it. Self-loads its own
  -- offers and renders nothing when there are none.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section v-if="offers.length > 0" class="rounded-lg border border-default p-4">
        <header class="mb-1 flex items-center gap-2">
            <UIcon name="i-lucide-gift" class="size-5 text-primary" />
            <h2 class="text-lg font-semibold">
                Offered to you
            </h2>
        </header>
        <p class="mb-3 text-sm text-muted">
            The owner deleted a file shared with you. Save your own copy to My Files before it's gone.
        </p>

        <ul class="divide-y divide-default">
            <li
                v-for="offer in offers"
                :key="offer.id"
                :aria-label="offer.name"
                class="flex items-center gap-3 py-2 text-sm"
            >
                <UIcon name="i-lucide-file" class="size-5 shrink-0 text-muted" />
                <div class="min-w-0 flex-1">
                    <p class="truncate font-medium" :title="offer.name">
                        {{ offer.name }}
                    </p>
                    <p class="truncate text-xs text-muted">
                        {{ formatBytes(offer.size) }} · save before {{ deadline(offer.expiresAt) }}
                    </p>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                    <UButton
                        icon="i-lucide-copy-plus"
                        color="primary"
                        variant="soft"
                        size="sm"
                        label="Save a copy"
                        aria-label="Save a copy"
                        :loading="busyID === offer.id"
                        :disabled="busyID !== null"
                        @click="accept(offer)"
                    />
                    <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        label="Decline"
                        aria-label="Decline"
                        :disabled="busyID !== null"
                        @click="decline(offer)"
                    />
                </div>
            </li>
        </ul>
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { DeletionOfferResponse } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Resource Access
    import {
        acceptDeletionOffer,
        declineDeletionOffer,
        listDeletionOffers,
    } from '../../resource-access/deletionOffers.ts';

    // Utils
    import { formatBytes, formatNodeDate } from '../../utils/formatters/index.ts';
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const offers = ref<DeletionOfferResponse[]>([]);
    const busyID = ref<string | null>(null);

    //------------------------------------------------------------------------------------------------------------------

    // A failed offers load just leaves the section empty -- it is a secondary surface over the trash, never a blocker.
    async function load() : Promise<void>
    {
        try { offers.value = (await listDeletionOffers()).offers; }
        catch { offers.value = []; }
    }

    function remove(id : string) : void
    {
        offers.value = offers.value.filter((offer) => offer.id !== id);
    }

    function deadline(expiresAt : string) : string
    {
        return formatNodeDate(expiresAt, session.timeFormat);
    }

    // Accept places the copy in My Files (root); the copy is fully independent of the deleted original thereafter --
    // and it charges the acceptor's quota, so the gauge refreshes.
    async function accept(offer : DeletionOfferResponse) : Promise<void>
    {
        busyID.value = offer.id;
        await runMutation(
            async () => { await acceptDeletionOffer(offer.id, { parentID: null }); },
            undefined,
            () =>
            {
                remove(offer.id);
                void session.refreshProfile().catch(() => undefined);
                toast.add({
                    title: 'Saved to your files',
                    description: `"${ offer.name }" is now in My Files.`,
                    color: 'success',
                });
            }
        );
        busyID.value = null;
    }

    async function decline(offer : DeletionOfferResponse) : Promise<void>
    {
        busyID.value = offer.id;
        await runMutation(
            () => declineDeletionOffer(offer.id),
            undefined,
            () => { remove(offer.id); }
        );
        busyID.value = null;
    }

    onMounted(load);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
