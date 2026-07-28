<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Users Tab
  --
  -- The instance's accounts at a glance: name, email, role, quota, joined. Read-only for now; management actions
  -- live behind the row menu as they land.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-4">
        <UAlert
            v-if="error"
            color="error"
            variant="soft"
            title="Couldn't load the user list."
            :actions="[ { label: 'Retry', color: 'error', variant: 'soft', onClick: () => load() } ]"
        />

        <div v-else class="overflow-x-auto rounded-lg border border-default">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-default text-left text-muted">
                        <th class="px-4 py-3 font-medium">
                            Name
                        </th>
                        <th class="px-4 py-3 font-medium">
                            Email
                        </th>
                        <th class="px-4 py-3 font-medium">
                            Role
                        </th>
                        <th class="px-4 py-3 font-medium">
                            Quota
                        </th>
                        <th class="px-4 py-3 font-medium">
                            Joined
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="user of users"
                        :key="user.id"
                        class="border-b border-default last:border-b-0"
                    >
                        <td class="px-4 py-3 font-medium">
                            {{ user.name ?? '—' }}
                        </td>
                        <td class="px-4 py-3 text-muted">
                            {{ user.email }}
                        </td>
                        <td class="px-4 py-3">
                            <UBadge
                                :label="user.role"
                                :color="user.role === 'admin' ? 'primary' : 'neutral'"
                                variant="subtle"
                                size="sm"
                            />
                        </td>
                        <td class="px-4 py-3 text-muted">
                            {{ user.quotaLimit === null ? 'Unlimited' : formatBytes(user.quotaLimit) }}
                        </td>
                        <td class="px-4 py-3 text-muted">
                            {{ formatNodeDate(user.createdAt, session.timeFormat) }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p v-if="!error" class="text-sm text-muted">
            {{ total }} {{ total === 1 ? 'account' : 'accounts' }}
        </p>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, ref } from 'vue';

    import type { AdminUserResponse } from '@fileshed/core';

    // Stores
    import { useSessionStore } from '../../stores/session.ts';

    // Resource Access
    import { listUsers } from '../../resource-access/admin.ts';

    // Utils
    import { formatBytes, formatNodeDate } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Data
    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();

    const users = ref<AdminUserResponse[]>([]);
    const total = ref(0);
    const error = ref<Error | null>(null);

    async function load() : Promise<void>
    {
        error.value = null;

        try
        {
            const page = await listUsers({ limit: 100 });
            users.value = page.users;
            total.value = page.total;
        }
        catch(caught)
        {
            error.value = caught instanceof Error ? caught : new Error(String(caught));
        }
    }

    onMounted(() => { void load(); });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
