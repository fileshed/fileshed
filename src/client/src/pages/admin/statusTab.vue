<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Status Tab
  --
  -- The instance's operational glance: storage backends, the latest garbage-collection and trash-purge sweeps, and
  -- the restart banner when a saved setting is waiting on one. Read-only by design -- this tab reports, the others
  -- act.
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
            <section class="flex flex-col gap-3">
                <h2 class="text-lg font-semibold text-highlighted">
                    Storage backends
                </h2>
                <div
                    v-for="backend of status.backends"
                    :key="backend.id"
                    class="flex items-center gap-3 rounded-lg border border-default p-4"
                >
                    <UIcon name="i-lucide-hard-drive" class="size-5 text-muted" />
                    <span class="font-medium">{{ backend.kind }}</span>
                    <UBadge
                        v-if="backend.isDefault"
                        label="Default"
                        color="primary"
                        variant="subtle"
                        size="sm"
                    />
                    <span class="ml-auto truncate font-mono text-xs text-muted">{{ backend.id }}</span>
                </div>
            </section>

            <section class="flex flex-col gap-3">
                <h2 class="text-lg font-semibold text-highlighted">
                    Background sweeps
                </h2>

                <div class="rounded-lg border border-default p-4">
                    <div class="flex items-center justify-between gap-4">
                        <h3 class="font-medium">
                            Garbage collection
                        </h3>
                        <span class="text-sm text-muted">{{ ranAt(status.gc) }}</span>
                    </div>
                    <p v-if="status.gc" class="mt-1 text-sm text-muted">
                        {{ status.gc.summary.candidates }} candidates,
                        {{ status.gc.summary.deleted }} deleted,
                        {{ status.gc.summary.kept }} kept,
                        {{ status.gc.summary.bytesFailed }} failed.
                    </p>
                </div>

                <div class="rounded-lg border border-default p-4">
                    <div class="flex items-center justify-between gap-4">
                        <h3 class="font-medium">
                            Trash purge
                        </h3>
                        <span class="text-sm text-muted">{{ ranAt(status.trashPurge) }}</span>
                    </div>
                    <p v-if="status.trashPurge" class="mt-1 text-sm text-muted">
                        {{ status.trashPurge.summary.candidates }} candidates,
                        {{ status.trashPurge.summary.purged }} purged,
                        {{ status.trashPurge.summary.failed }} failed.
                    </p>
                </div>
            </section>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { onMounted, ref } from 'vue';

    import type { AdminStatusResponse } from '@fileshed/core';

    // Stores
    import { useAdminSettingsStore } from '../../stores/adminSettings.ts';
    import { useSessionStore } from '../../stores/session.ts';

    // Resource Access
    import { adminStatus } from '../../resource-access/admin.ts';

    // Components
    import RestartBanner from '../../components/admin/restartBanner.vue';

    // Utils
    import { formatNodeDate } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Data
    //------------------------------------------------------------------------------------------------------------------

    const session = useSessionStore();
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

    function ranAt(run : { ranAt : string } | null) : string
    {
        return run === null ? 'Not run yet' : formatNodeDate(run.ranAt, session.timeFormat);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
