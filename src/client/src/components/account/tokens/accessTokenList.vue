<!----------------------------------------------------------------------------------------------------------------------
  -- Access Token List
  --
  -- The caller's tokens: name, identifying start characters, scopes, and lifecycle dates -- never a value. Revoke is
  -- two-click: the button arms into a confirm state and disarms on its own, since a revoked credential cannot be
  -- un-revoked, only re-created.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="rounded-lg border border-default">
        <div v-if="tokens.length === 0" class="p-4 text-sm text-muted">
            No access tokens yet.
        </div>

        <ul v-else class="divide-y divide-default">
            <li
                v-for="token in tokens"
                :key="token.id"
                class="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center"
            >
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="font-medium text-default">{{ token.name }}</span>
                        <code v-if="token.start" class="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">
                            {{ token.start }}…
                        </code>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5">
                        <UBadge
                            v-for="entry in catalogFor(token.scopes)"
                            :key="entry.scope"
                            :color="entry.danger ? 'error' : 'neutral'"
                            variant="subtle"
                            size="sm"
                        >
                            {{ entry.label }}
                        </UBadge>
                    </div>
                    <p class="mt-1 text-xs text-dimmed">
                        Created {{ formatDate(token.createdAt) }}
                        · {{ token.lastUsedAt ? `last used ${ formatDate(token.lastUsedAt) }` : 'never used' }}
                        · {{ token.expiresAt ? `expires ${ formatDate(token.expiresAt) }` : 'no expiry' }}
                    </p>
                </div>

                <UButton
                    :label="arming === token.id ? 'Confirm revoke' : 'Revoke'"
                    :color="arming === token.id ? 'error' : 'neutral'"
                    :variant="arming === token.id ? 'solid' : 'ghost'"
                    size="sm"
                    :loading="revoking === token.id"
                    @click="revoke(token.id)"
                />
            </li>
        </ul>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, ref } from 'vue';

    import type { AccessTokenResponse, AccessTokenScope } from '@fileshed/core';

    // Resource Access
    import { listAccessTokens, revokeAccessToken } from '../../../resource-access/accessTokens.ts';

    // Utils
    import { useRunWithToast } from '../../../utils/runWithToast.ts';

    // Catalog
    import { type ScopeEntry, scopeCatalog } from './scopeCatalog.ts';

    //------------------------------------------------------------------------------------------------------------------

    const { runMutation } = useRunWithToast();

    const tokens = ref<AccessTokenResponse[]>([]);
    const arming = ref<string | null>(null);
    const revoking = ref<string | null>(null);

    let disarmTimer : ReturnType<typeof setTimeout> | null = null;

    //------------------------------------------------------------------------------------------------------------------

    function catalogFor(scopes : AccessTokenScope[]) : ScopeEntry[]
    {
        return scopeCatalog.filter((entry) => scopes.includes(entry.scope));
    }

    function formatDate(iso : string) : string
    {
        return new Date(iso).toLocaleDateString();
    }

    async function refresh() : Promise<void>
    {
        const response = await listAccessTokens();
        tokens.value = response.accessTokens;
    }

    function revoke(id : string) : void
    {
        if(arming.value !== id)
        {
            arming.value = id;
            if(disarmTimer !== null) { clearTimeout(disarmTimer); }
            disarmTimer = setTimeout(() => { arming.value = null; }, 4000);
            return;
        }

        arming.value = null;
        revoking.value = id;
        void runMutation(
            async () =>
            {
                await revokeAccessToken(id);
                await refresh();
            },
            undefined,
            undefined
        ).finally(() => { revoking.value = null; });
    }

    onMounted(() => { void refresh(); });

    defineExpose({ refresh });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
