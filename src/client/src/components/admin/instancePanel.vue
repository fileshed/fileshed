<!----------------------------------------------------------------------------------------------------------------------
  -- Instance Panel
  --
  -- What this deployment *is*, as opposed to what it holds: build, dialect, how long the process has been up, and the
  -- three switches an operator most often needs to confirm from a distance.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <section class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold text-highlighted">
            Instance
        </h2>

        <dl class="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-default p-4 sm:grid-cols-3">
            <div v-for="row of rows" :key="row.label" class="flex flex-col gap-0.5">
                <dt class="text-xs text-muted">
                    {{ row.label }}
                </dt>
                <dd class="text-sm font-medium">
                    {{ row.value }}
                </dd>
            </div>
        </dl>
    </section>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { OverviewInstance } from '@fileshed/core';

    // Utils
    import { formatUptime } from '../../utils/formatters/index.ts';

    //------------------------------------------------------------------------------------------------------------------

    const props = defineProps<{ instance : OverviewInstance }>();

    const DIALECT_LABELS : Record<OverviewInstance['databaseKind'], string> = {
        sqlite: 'SQLite',
        postgres: 'PostgreSQL',
    };

    const rows = computed(() => [
        { label: 'Version', value: props.instance.version },
        { label: 'Database', value: DIALECT_LABELS[props.instance.databaseKind] },
        { label: 'Uptime', value: formatUptime(props.instance.uptimeSeconds) },
        { label: 'Email', value: props.instance.emailEnabled ? 'Configured' : 'Not configured' },
        { label: 'Sign-in providers', value: String(props.instance.activeProviders) },
        { label: 'Sign-ups', value: props.instance.signUpEnabled ? 'Open' : 'Closed' },
    ]);
</script>

<!--------------------------------------------------------------------------------------------------------------------->
