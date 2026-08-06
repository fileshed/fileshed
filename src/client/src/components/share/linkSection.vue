<!----------------------------------------------------------------------------------------------------------------------
  -- Link Section
  --
  -- The share dialog's public-link surface, shown for files only (a folder carries no bytes to serve). It has two
  -- states: nothing published yet, offering to mint a link; or the live link with its /d/<token> URL, a copy for
  -- either form -- as it renders, or as a download -- and a revoke. One token backs both forms, so a second link
  -- would be the same capability twice over and is not offered; revoking the last one returns the section to its
  -- create state. The listing still handles several, since the API stays free to mint them.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold">
            Get link
        </h3>

        <ul v-if="links.length > 0" class="flex flex-col gap-2">
            <li
                v-for="link in links"
                :key="link.id"
                class="flex items-center gap-2 rounded-lg p-2 ring-1 ring-default"
            >
                <span class="min-w-0 flex-1 truncate font-mono text-sm">{{ absoluteUrl(link) }}</span>
                <UTooltip v-for="form in copyForms" :key="form.label" :text="form.label">
                    <UButton
                        :icon="form.icon"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :aria-label="form.label"
                        @click="copy(link, form)"
                    />
                </UTooltip>
                <UTooltip text="Revoke link">
                    <UButton
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="ghost"
                        size="sm"
                        aria-label="Revoke link"
                        :loading="pendingRowID === link.id"
                        @click="revoke(link)"
                    />
                </UTooltip>
            </li>
        </ul>
        <p v-else-if="!loading" class="text-sm text-muted">
            No public links yet.
        </p>

        <div v-if="links.length === 0 && !loading" class="flex">
            <UButton
                label="Create link"
                icon="i-lucide-link"
                color="neutral"
                variant="subtle"
                :loading="creating"
                @click="create()"
            />
        </div>
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { NodeResponse, PublicLinkResponse } from '@fileshed/core';

    // Resource Access
    import { createPublicLink, listLinksForNode, revokePublicLink } from '../../resource-access/publicLinks.ts';

    // Utils
    import { copyToClipboard } from '../../utils/copyToClipboard.ts';
    import { publicLinkUrl } from '../../utils/publicLinkUrl.ts';
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    interface CopyForm
    {
        label : string;
        icon : string;
        download : boolean;
    }

    const props = defineProps<{
        node : NodeResponse;
    }>();

    // Raised when a link is minted or killed, so a listing showing this node can re-read what it now exposes.
    const emit = defineEmits<{
        changed : [];
    }>();

    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const links = ref<PublicLinkResponse[]>([]);
    const loading = ref(false);
    const creating = ref(false);
    const pendingRowID = ref<string | null>(null);

    // The two ways to hand out the same token.
    const copyForms : CopyForm[] = [
        { label: 'Copy link', icon: 'i-lucide-copy', download: false },
        { label: 'Copy download link', icon: 'i-lucide-download', download: true },
    ];

    //------------------------------------------------------------------------------------------------------------------

    function absoluteUrl(link : PublicLinkResponse, download = false) : string
    {
        return publicLinkUrl(link.url, download);
    }

    async function refresh() : Promise<void>
    {
        links.value = (await listLinksForNode(props.node.id)).links.filter((link) => link.revokedAt === null);
    }

    async function load() : Promise<void>
    {
        await runMutation(refresh, loading);
    }

    function create() : void
    {
        void runMutation(async () =>
        {
            await createPublicLink(props.node.id);
            await refresh();
        }, creating, () => emit('changed'));
    }

    async function copy(link : PublicLinkResponse, form : CopyForm) : Promise<void>
    {
        const url = absoluteUrl(link, form.download);

        if(await copyToClipboard(url))
        {
            toast.add({ title: 'Link copied', description: url, color: 'success' });
        }
        else
        {
            toast.add({
                title: 'Couldn\'t copy the link',
                description: 'Copy it from the field instead.',
                color: 'error',
            });
        }
    }

    function revoke(link : PublicLinkResponse) : void
    {
        pendingRowID.value = link.id;
        void runMutation(async () =>
        {
            await revokePublicLink(link.id);
            await refresh();
        }, undefined, () => emit('changed')).finally(() => { pendingRowID.value = null; });
    }

    onMounted(load);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
