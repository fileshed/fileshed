<!----------------------------------------------------------------------------------------------------------------------
  -- Link Section
  --
  -- The share dialog's public-link surface, shown for files only (a folder carries no bytes to serve). Lists the node's
  -- live links -- each with its disposition badge, its ready-to-use /d/<token> URL, a copy-to-clipboard button, and a
  -- revoke -- and mints new ones: a view link (inline) and a download link (attachment). A revoked link stops serving
  -- and drops off the list.
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
                <UBadge
                    :label="dispositionLabel(link)"
                    :color="link.disposition === 'inline' ? 'primary' : 'neutral'"
                    variant="soft"
                    size="sm"
                />
                <span class="min-w-0 flex-1 truncate font-mono text-sm">{{ absoluteUrl(link) }}</span>
                <UTooltip text="Copy link">
                    <UButton
                        icon="i-lucide-copy"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        aria-label="Copy link"
                        @click="copy(link)"
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

        <div class="flex items-center gap-2">
            <UButton
                label="Create view link"
                icon="i-lucide-eye"
                color="neutral"
                variant="subtle"
                :loading="creating"
                @click="create('view', 'inline')"
            />
            <UButton
                label="Create download link"
                icon="i-lucide-download"
                color="neutral"
                variant="subtle"
                :loading="creating"
                @click="create('download', 'attachment')"
            />
        </div>
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { NodeResponse, PublicLinkDisposition, PublicLinkMode, PublicLinkResponse } from '@fileshed/core';

    // Resource Access
    import { createPublicLink, listLinksForNode, revokePublicLink } from '../../resource-access/publicLinks.ts';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        node : NodeResponse;
    }>();

    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const links = ref<PublicLinkResponse[]>([]);
    const loading = ref(false);
    const creating = ref(false);
    const pendingRowID = ref<string | null>(null);

    //------------------------------------------------------------------------------------------------------------------

    // The link's full, shareable address: its /d/<token> path resolved against the app's own origin, so a recipient
    // can paste it anywhere. The server hands back the path; the origin is the browser's.
    function absoluteUrl(link : PublicLinkResponse) : string
    {
        return `${ window.location.origin }${ link.url }`;
    }

    function dispositionLabel(link : PublicLinkResponse) : string
    {
        return link.disposition === 'inline' ? 'Inline' : 'Download';
    }

    async function refresh() : Promise<void>
    {
        links.value = (await listLinksForNode(props.node.id)).links.filter((link) => link.revokedAt === null);
    }

    async function load() : Promise<void>
    {
        await runMutation(refresh, loading);
    }

    function create(mode : PublicLinkMode, disposition : PublicLinkDisposition) : void
    {
        void runMutation(async () =>
        {
            await createPublicLink(props.node.id, { mode, disposition });
            await refresh();
        }, creating);
    }

    async function copy(link : PublicLinkResponse) : Promise<void>
    {
        const url = absoluteUrl(link);

        try
        {
            await navigator.clipboard.writeText(url);
            toast.add({ title: 'Link copied', description: url, color: 'success' });
        }
        catch
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
        }).finally(() => { pendingRowID.value = null; });
    }

    onMounted(load);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
