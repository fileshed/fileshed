<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Users Tab
  --
  -- The instance's accounts: searchable (email or name), sortable, with charged usage, quota, ban state, and the
  -- per-row management actions. Actions that answer the refreshed row merge it in place; refetches happen only when
  -- the listing itself changes shape (search, sort).
  --
  -- The instance settings ride along for the set-quota modal alone: its inherit option names the current default in
  -- so many bytes. A row's own quota column needs nothing from them -- the listing already carries what is enforced.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-4">
        <div class="flex gap-2">
            <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="Search accounts…"
                class="max-w-xs flex-1"
            />
            <USelect v-model="searchField" :items="searchFieldItems" class="w-32" />
        </div>

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
                        <th class="px-4 py-3">
                            <SortHeader label="Account" sort-key="email" :state="sort" @toggle="toggleSort" />
                        </th>
                        <th class="px-4 py-3 font-medium">
                            Role
                        </th>
                        <th class="px-4 py-3 font-medium">
                            Usage
                        </th>
                        <th class="px-4 py-3 font-medium">
                            Quota
                        </th>
                        <th class="px-4 py-3">
                            <SortHeader label="Joined" sort-key="createdAt" :state="sort" @toggle="toggleSort" />
                        </th>
                        <th class="px-2 py-3" />
                    </tr>
                </thead>
                <tbody>
                    <UserRow
                        v-for="user of users"
                        :key="user.id"
                        :user="user"
                        @quota="quotaModal?.open(user)"
                        @password="passwordModal?.open(user)"
                        @ban="banModal?.open(user)"
                        @unban="runRowAction(() => unbanUser(user.id))"
                        @promote="runRowAction(() => setUserRole(user.id, 'admin'))"
                        @demote="runRowAction(() => setUserRole(user.id, 'user'))"
                        @revoke-sessions="signOutEverywhere(user)"
                    />
                </tbody>
            </table>
            <p v-if="users.length === 0" class="p-6 text-center text-sm text-muted">
                No accounts match.
            </p>
        </div>

        <p v-if="!error" class="text-sm text-muted">
            {{ total }} {{ total === 1 ? 'account' : 'accounts' }}
        </p>

        <SetQuotaModal ref="quotaModal" :default-quota="settings.defaultQuota" @saved="mergeRow" />
        <SetPasswordModal ref="passwordModal" />
        <BanUserModal ref="banModal" @saved="mergeRow" />
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, ref, watch } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { AdminUserResponse, AdminUserSearchField, AdminUserSortKey } from '@fileshed/core';

    // Stores
    import { useAdminSettingsStore } from '../../stores/adminSettings.ts';

    // Resource Access
    import { listUsers, revokeUserSessions, setUserRole, unbanUser } from '../../resource-access/admin.ts';

    // Components
    import UserRow from '../../components/admin/userRow.vue';
    import SortHeader from '../../components/admin/sortHeader.vue';
    import SetQuotaModal from '../../components/admin/modals/setQuotaModal.vue';
    import SetPasswordModal from '../../components/admin/modals/setPasswordModal.vue';
    import BanUserModal from '../../components/admin/modals/banUserModal.vue';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Listing state
    //------------------------------------------------------------------------------------------------------------------

    const { runMutation } = useRunWithToast();
    const toast = useToast();
    const settings = useAdminSettingsStore();

    const users = ref<AdminUserResponse[]>([]);
    const total = ref(0);
    const error = ref<Error | null>(null);

    const search = ref('');
    const searchField = ref<AdminUserSearchField>('email');
    const searchFieldItems = [
        { label: 'Email', value: 'email' },
        { label: 'Name', value: 'name' },
    ];

    const sort = ref<{ key : AdminUserSortKey; direction : 'asc' | 'desc' } | null>(null);

    async function load() : Promise<void>
    {
        error.value = null;

        try
        {
            const trimmed = search.value.trim();
            const page = await listUsers({
                limit: 100,
                ...trimmed === '' ? {} : { search: trimmed, searchField: searchField.value },
                ...sort.value === null ? {} : { sortBy: sort.value.key, sortDirection: sort.value.direction },
            });
            users.value = page.users;
            total.value = page.total;
        }
        catch(caught)
        {
            error.value = caught instanceof Error ? caught : new Error(String(caught));
        }
    }

    onMounted(() =>
    {
        void load();
        void settings.ensureLoaded();
    });

    // Typing re-queries after a beat; switching the field or the sort re-queries at once.
    let debounce : ReturnType<typeof setTimeout> | undefined;
    watch(search, () =>
    {
        clearTimeout(debounce);
        debounce = setTimeout(() => { void load(); }, 300);
    });
    watch([ searchField, sort ], () => { void load(); });

    function toggleSort(key : AdminUserSortKey) : void
    {
        if(sort.value?.key !== key) { sort.value = { key, direction: 'asc' }; }
        else if(sort.value.direction === 'asc') { sort.value = { key, direction: 'desc' }; }
        else { sort.value = null; }
    }

    //------------------------------------------------------------------------------------------------------------------
    // Row actions
    //------------------------------------------------------------------------------------------------------------------

    const quotaModal = ref<InstanceType<typeof SetQuotaModal> | null>(null);
    const passwordModal = ref<InstanceType<typeof SetPasswordModal> | null>(null);
    const banModal = ref<InstanceType<typeof BanUserModal> | null>(null);

    function mergeRow(updated : AdminUserResponse) : void
    {
        users.value = users.value.map((user) =>
        {
            return user.id === updated.id ? updated : user;
        });
    }

    const pending = ref(false);

    function runRowAction(act : () => Promise<AdminUserResponse>) : void
    {
        void runMutation(async () => mergeRow(await act()), pending);
    }

    function signOutEverywhere(user : AdminUserResponse) : void
    {
        void runMutation(() => revokeUserSessions(user.id), pending, () =>
        {
            toast.add({ title: `Signed ${ user.name ?? user.email } out everywhere.` });
        });
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
