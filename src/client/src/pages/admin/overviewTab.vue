<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Overview Tab
  --
  -- The admin landing page: who is on the instance, what it holds, what it is waiting to reclaim, and what this
  -- deployment is -- then the storage backends and the latest background sweeps. The one thing it does rather than
  -- reports is run a sweep on demand, which reloads the whole readout: the figures a sweep moves (reclaimable bytes,
  -- trash pending) are already on this page, so the reclaim shows up where the admin is looking.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-6">
        <RestartBanner />

        <UAlert
            v-if="error"
            color="error"
            variant="soft"
            title="Couldn't load the server status."
            :actions="[ { label: 'Retry', color: 'error', variant: 'soft', onClick: () => load() } ]"
        />

        <template v-else-if="status">
            <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile label="Users" icon="i-lucide-users" :detail="userDetail">
                    <template #value>
                        {{ status.overview.users.total }}
                        <span
                            v-if="status.overview.users.newThisWeek > 0"
                            class="text-sm font-medium text-success"
                        >+{{ status.overview.users.newThisWeek }} this week</span>
                    </template>
                </StatTile>

                <StatTile
                    label="Files"
                    icon="i-lucide-file"
                    :value="String(status.overview.nodes.files)"
                    :detail="`${ status.overview.nodes.folders } folders`"
                />

                <StatTile
                    label="Logical storage"
                    icon="i-lucide-scale"
                    :value="formatBytes(status.overview.storage.logicalBytes)"
                    detail="Charged against quotas"
                />

                <StatTile
                    label="Physical storage"
                    icon="i-lucide-hard-drive"
                    :value="formatBytes(status.overview.storage.physicalBytes)"
                    :detail="storageGapDetail"
                />
            </div>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatTile
                    label="Trash pending"
                    icon="i-lucide-trash-2"
                    :value="String(status.overview.trash.count)"
                    :detail="`${ formatBytes(status.overview.trash.bytes) } still charged`"
                />

                <StatTile
                    label="Graveyard reclaimable"
                    icon="i-lucide-recycle"
                    :value="formatBytes(status.overview.storage.graveyardBytes)"
                    :detail="`${ status.overview.storage.graveyardCount } blobs awaiting collection`"
                />

                <StatTile
                    label="Pending access requests"
                    icon="i-lucide-user-plus"
                    :value="String(status.overview.accessRequestsPending)"
                    detail="Waiting on their owners"
                />
            </div>

            <InstancePanel :instance="status.overview.instance" />

            <BackendList :backends="status.backends" />

            <section class="flex flex-col gap-3">
                <h2 class="text-lg font-semibold text-highlighted">
                    Background sweeps
                </h2>

                <SweepSummary
                    title="Garbage collection"
                    sweep="gc"
                    :run="status.gc"
                    @ran="load"
                >
                    {{ status.gc === null ? '' : describeGcRun(status.gc.summary) }}
                </SweepSummary>

                <SweepSummary
                    title="Trash purge"
                    sweep="trashPurge"
                    :run="status.trashPurge"
                    @ran="load"
                >
                    {{ status.trashPurge === null ? '' : describeTrashPurgeRun(status.trashPurge.summary) }}
                </SweepSummary>

                <SweepSummary
                    title="Abandoned uploads"
                    sweep="partials"
                    :run="status.partials"
                    @ran="load"
                >
                    {{ status.partials === null ? '' : describePartialsRun(status.partials.summary) }}
                </SweepSummary>
            </section>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';

    import type { AdminStatusResponse } from '@fileshed/core';

    // Stores
    import { useAdminSettingsStore } from '../../stores/adminSettings.ts';

    // Resource Access
    import { adminStatus } from '../../resource-access/admin.ts';

    // Engines
    import { describeGcRun, describePartialsRun, describeTrashPurgeRun } from '../../engines/sweepRun.ts';

    // Components
    import BackendList from '../../components/admin/backendList.vue';
    import InstancePanel from '../../components/admin/instancePanel.vue';
    import RestartBanner from '../../components/admin/restartBanner.vue';
    import StatTile from '../../components/admin/statTile.vue';
    import SweepSummary from '../../components/admin/sweepSummary.vue';

    // Utils
    import { formatBytes } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Data
    //------------------------------------------------------------------------------------------------------------------

    const settings = useAdminSettingsStore();

    const status = ref<AdminStatusResponse | null>(null);
    const error = ref<Error | null>(null);

    async function load() : Promise<void>
    {
        error.value = null;

        try
        {
            status.value = await adminStatus();
        }
        catch(caught)
        {
            error.value = caught instanceof Error ? caught : new Error(String(caught));
        }
    }

    onMounted(() =>
    {
        void load();

        // The restart banner reads the settings store; a fresh landing on this tab has not loaded it yet.
        void settings.load();
    });

    //------------------------------------------------------------------------------------------------------------------
    // Presentation
    //------------------------------------------------------------------------------------------------------------------

    const userDetail = computed(() =>
    {
        const users = status.value?.overview.users;
        if(users === undefined) { return ''; }

        const parts = [ `${ users.admins } ${ users.admins === 1 ? 'admin' : 'admins' }` ];
        if(users.banned > 0) { parts.push(`${ users.banned } banned`); }

        return parts.join(' · ');
    });

    // How much less the store holds than users are charged for. Deduplication is what drives the gap, but it is not
    // the only thing in it -- avatars and the instance logo are live blobs no file node charges anyone for -- so the
    // figure is phrased as the comparison it actually is. Nothing to quote on an empty instance: with no logical
    // bytes there is no ratio, and "100% smaller" would be a lie.
    const storageGapDetail = computed(() =>
    {
        const storage = status.value?.overview.storage;
        if(storage === undefined || storage.logicalBytes <= 0) { return undefined; }

        const gap = (storage.logicalBytes - storage.physicalBytes) / storage.logicalBytes;

        return `${ Math.max(0, Math.round(gap * 100)) }% smaller than charged`;
    });
</script>

<!--------------------------------------------------------------------------------------------------------------------->
