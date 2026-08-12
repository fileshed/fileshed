<!----------------------------------------------------------------------------------------------------------------------
  -- People Section
  --
  -- The share dialog's user-to-user grant surface: resolve an email to a real account before granting (typo safety),
  -- then grant at a chosen role. Below, the node's current grants -- the owner (shown, never editable) plus each
  -- grantee, rendered from the summary the shares-list response carries alongside each grant (avatar, name, email),
  -- with an in-place role select (a re-grant at a new role, which the server upserts) and a revoke.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold">
            People with access
        </h3>

        <div class="flex flex-col gap-2">
            <div class="flex items-start gap-2">
                <UInput
                    v-model="email"
                    type="email"
                    placeholder="Add people by email"
                    class="flex-1"
                    :disabled="looking || granting"
                    @keydown.enter.prevent="doLookup"
                />
                <UButton
                    label="Look up"
                    color="neutral"
                    variant="subtle"
                    :loading="looking"
                    :disabled="email.trim() === ''"
                    @click="doLookup"
                />
            </div>

            <p v-if="lookupError" class="text-sm text-error">
                {{ lookupError }}
            </p>

            <div v-if="candidate" class="flex items-center gap-3 rounded-lg p-2 ring-1 ring-default">
                <UAvatar :src="candidate.image ?? undefined" :alt="candidate.name" />
                <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">
                        {{ candidate.name }}
                    </p>
                    <p class="truncate text-xs text-muted">
                        {{ candidate.email }}
                    </p>
                </div>

                <span v-if="isOwnerCandidate" class="text-xs text-muted">Owner</span>
                <template v-else>
                    <USelect v-model="role" :items="roleItems" size="sm" class="w-28" />
                    <UButton label="Share" :loading="granting" @click="confirmGrant" />
                </template>
            </div>
        </div>

        <div v-if="requests.length > 0" class="flex flex-col gap-2">
            <h4 class="text-xs font-semibold uppercase text-muted">
                Pending requests
            </h4>
            <ul class="flex flex-col gap-1">
                <li
                    v-for="entry in requests"
                    :key="entry.request.id"
                    :aria-label="`Request from ${ entry.requester.name }`"
                    class="flex items-center gap-3 py-1"
                >
                    <UAvatar :src="entry.requester.image ?? undefined" :alt="entry.requester.name" />
                    <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">
                            {{ entry.requester.name }}
                        </p>
                        <p class="truncate text-xs text-muted">
                            {{ entry.requester.email }}
                        </p>
                        <p v-if="entry.request.message" class="truncate text-xs italic text-muted">
                            "{{ entry.request.message }}"
                        </p>
                    </div>

                    <UBadge color="neutral" variant="subtle" size="sm" class="capitalize">
                        {{ entry.request.requestedRole }}
                    </UBadge>
                    <UButton
                        label="Approve"
                        color="primary"
                        variant="soft"
                        size="sm"
                        aria-label="Approve request"
                        :loading="pendingRequestID === entry.request.id"
                        :disabled="pendingRequestID !== null"
                        @click="approve(entry.request)"
                    />
                    <UButton
                        label="Deny"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        aria-label="Deny request"
                        :disabled="pendingRequestID !== null"
                        @click="decline(entry.request)"
                    />
                </li>
            </ul>
        </div>

        <ul class="flex flex-col gap-1">
            <li v-if="owner" class="flex items-center gap-3 py-1">
                <UAvatar :src="owner.image ?? undefined" :alt="owner.name" />
                <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">
                        {{ owner.name }}
                    </p>
                    <p class="truncate text-xs text-muted">
                        {{ owner.email }}
                    </p>
                </div>
                <span class="text-xs text-muted">Owner</span>
            </li>

            <li v-for="entry in grants" :key="entry.share.id" class="flex items-center gap-3 py-1">
                <UAvatar :src="entry.grantee.image ?? undefined" :alt="entry.grantee.name" />
                <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">
                        {{ entry.grantee.name }}
                    </p>
                    <p class="truncate text-xs text-muted">
                        {{ entry.grantee.email }}
                    </p>
                </div>

                <USelect
                    :model-value="entry.share.role"
                    :items="roleItems"
                    size="sm"
                    class="w-28"
                    :disabled="pendingRowID === entry.share.id"
                    @update:model-value="(value) => changeRole(entry, value as ShareRole)"
                />
                <UTooltip text="Remove access">
                    <UButton
                        icon="i-lucide-x"
                        color="error"
                        variant="ghost"
                        size="sm"
                        aria-label="Remove access"
                        :loading="pendingRowID === entry.share.id"
                        @click="revoke(entry)"
                    />
                </UTooltip>
            </li>
        </ul>
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import {
        type AccessRequestListEntry,
        type AccessRequestResponse,
        type NodeResponse,
        type ShareListEntry,
        type ShareRole,
        type UserSummary,
        shareRoles,
    } from '@fileshed/core';

    // Resource Access
    import { ApiError } from '../../resource-access/apiError.ts';
    import {
        declineAccessRequest,
        grantAccessRequest,
        listAccessRequests,
    } from '../../resource-access/accessRequests.ts';
    import { grantShare, listSharesForNode, revokeShare } from '../../resource-access/shares.ts';
    import { lookupUser } from '../../resource-access/users.ts';

    // Utils
    import { describeApiError, useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{
        node : NodeResponse;
        owner : UserSummary | null;
    }>();

    // Raised whenever the set of people holding a grant changes, so a listing showing this node can re-read what it
    // now exposes. A role change is not one of these: the same people still hold access.
    const emit = defineEmits<{
        changed : [];
    }>();

    const toast = useToast();
    const { runMutation } = useRunWithToast();

    const grants = ref<ShareListEntry[]>([]);
    const requests = ref<AccessRequestListEntry[]>([]);
    const loading = ref(false);
    const pendingRequestID = ref<string | null>(null);

    const email = ref('');
    const candidate = ref<UserSummary | null>(null);
    const role = ref<ShareRole>('viewer');
    const lookupError = ref<string | null>(null);
    const looking = ref(false);
    const granting = ref(false);
    const pendingRowID = ref<string | null>(null);

    const roleItems = shareRoles.map((value) => ({
        label: `${ value[0]?.toUpperCase() ?? '' }${ value.slice(1) }`,
        value,
    }));

    //------------------------------------------------------------------------------------------------------------------

    const isOwnerCandidate = computed(() =>
        candidate.value !== null && props.owner !== null && candidate.value.id === props.owner.id);

    async function refresh() : Promise<void>
    {
        grants.value = (await listSharesForNode(props.node.id)).shares;

        // Pending requests are the actionable half of access requests, scoped here to this node from the caller's whole
        // incoming set (there is no per-node request listing). Best-effort: a failed load leaves the group empty rather
        // than blanking the grants the section is primarily for.
        try
        {
            const incoming = (await listAccessRequests()).incoming;
            requests.value = incoming.filter((entry) => entry.request.nodeID === props.node.id);
        }
        catch { requests.value = []; }
    }

    async function load() : Promise<void>
    {
        await runMutation(refresh, loading);
    }

    async function doLookup() : Promise<void>
    {
        const value = email.value.trim();
        if(value === '') { return; }

        lookupError.value = null;
        candidate.value = null;
        looking.value = true;

        try
        {
            candidate.value = await lookupUser(value);
        }
        catch(caught)
        {
            if(caught instanceof ApiError && caught.status === 404)
            {
                lookupError.value = 'No user with that email.';
            }
            else
            {
                toast.add({ title: 'That didn\'t work', description: describeApiError(caught), color: 'error' });
            }
        }
        finally
        {
            looking.value = false;
        }
    }

    function confirmGrant() : void
    {
        const user = candidate.value;
        if(user === null || isOwnerCandidate.value) { return; }

        void runMutation(
            async () =>
            {
                await grantShare(props.node.id, { granteeUserID: user.id, role: role.value });
                await refresh();
            },
            granting,
            () =>
            {
                emit('changed');
                email.value = '';
                candidate.value = null;
                role.value = 'viewer';
                lookupError.value = null;
            }
        );
    }

    function changeRole(entry : ShareListEntry, next : ShareRole) : void
    {
        if(next === entry.share.role) { return; }

        pendingRowID.value = entry.share.id;
        void runMutation(async () =>
        {
            await grantShare(props.node.id, { granteeUserID: entry.share.granteeUserID, role: next });
            await refresh();
        }).finally(() => { pendingRowID.value = null; });
    }

    function revoke(entry : ShareListEntry) : void
    {
        pendingRowID.value = entry.share.id;
        void runMutation(async () =>
        {
            await revokeShare(entry.share.id);
            await refresh();
        }, undefined, () => emit('changed')).finally(() => { pendingRowID.value = null; });
    }

    //------------------------------------------------------------------------------------------------------------------
    // Access requests -- approving mints a grant at the role the requester asked for (the server decides the role from
    // the request, so there is no role picker here), which then appears in the grants list above; denying just resolves
    // it. Either way a refresh drops the row from this group.
    //------------------------------------------------------------------------------------------------------------------

    function approve(request : AccessRequestResponse) : void
    {
        pendingRequestID.value = request.id;
        void runMutation(async () =>
        {
            await grantAccessRequest(request.id);
            await refresh();
        }, undefined, () => emit('changed')).finally(() => { pendingRequestID.value = null; });
    }

    function decline(request : AccessRequestResponse) : void
    {
        pendingRequestID.value = request.id;
        void runMutation(async () =>
        {
            await declineAccessRequest(request.id);
            await refresh();
        }).finally(() => { pendingRequestID.value = null; });
    }

    onMounted(load);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
