<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Settings Tab
  --
  -- The instance-settings editor: every vocabulary key as a SettingField, grouped by what it governs. The
  -- presentation map here is deliberately the only place a key gains a human label -- the vocabulary stays
  -- wire-shaped, and a key without an entry here simply doesn't render, which is the safe failure for a client
  -- older than its server.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <div class="flex flex-col gap-8">
        <RestartBanner />

        <UAlert
            v-if="settings.error"
            color="error"
            variant="soft"
            title="Couldn't load the instance settings."
            :actions="[ { label: 'Retry', color: 'error', variant: 'soft', onClick: () => settings.load() } ]"
        />

        <template v-else>
            <section
                v-for="group of groups"
                :key="group.heading"
                class="flex flex-col gap-3"
            >
                <h2 class="text-lg font-semibold text-highlighted">
                    {{ group.heading }}
                </h2>
                <SettingField
                    v-for="field of group.fields"
                    :key="field.entry.key"
                    :entry="field.entry"
                    :label="field.label"
                    :description="field.description"
                    :unit="field.unit"
                    :zero-label="field.zeroLabel"
                    :sweep="field.sweep"
                />
            </section>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted } from 'vue';

    import type { AdminSettingEntry, AdminSettingKey, SweepKind } from '@fileshed/core';

    // Stores
    import { useAdminSettingsStore } from '../../stores/adminSettings.ts';

    // Components
    import RestartBanner from '../../components/admin/restartBanner.vue';
    import SettingField from '../../components/admin/settingField.vue';

    //------------------------------------------------------------------------------------------------------------------
    // Presentation
    //------------------------------------------------------------------------------------------------------------------

    interface FieldPresentation
    {
        key : AdminSettingKey;
        label : string;
        description : string;
        unit ?: 'bytes' | 'days';
        zeroLabel ?: string;
        sweep ?: { kind : SweepKind; label : string };
    }

    const groupLayout : { heading : string; keys : FieldPresentation[] }[] = [
        {
            heading: 'Registration',
            keys: [
                {
                    key: 'SIGN_UP_ENABLED',
                    label: 'Allow sign-ups',
                    description: 'Whether visitors can create their own accounts. Applies immediately; the sign-in '
                        + 'page hides its sign-up link while this is off.',
                },
            ],
        },
        {
            heading: 'Limits',
            keys: [
                {
                    key: 'UPLOAD_MAX_BYTES',
                    label: 'Maximum upload size',
                    description: 'The largest single file an upload may be. A size like 20gb or 500mb, or raw bytes.',
                    unit: 'bytes',
                },
                {
                    key: 'AVATAR_MAX_BYTES',
                    label: 'Maximum avatar size',
                    description: 'The largest avatar image an account may upload. A size like 2mb, or raw bytes.',
                    unit: 'bytes',
                },
                {
                    key: 'DEFAULT_QUOTA_BYTES',
                    label: 'Default storage quota',
                    description: 'The cap every account with no quota of its own inherits, and which they follow '
                        + 'whenever this changes. A size like 20gb, or 0 for unlimited.',
                    unit: 'bytes',
                    zeroLabel: 'Unlimited',
                },
            ],
        },
        {
            heading: 'Retention',
            keys: [
                {
                    key: 'TRASH_PURGE_DAYS',
                    label: 'Trash retention',
                    description: 'How many days a trashed item survives before it is permanently deleted. '
                        + '0 purges on the next sweep.',
                    unit: 'days',
                    sweep: { kind: 'trashPurge', label: 'Trash purge' },
                },
                {
                    key: 'GC_GRACE_DAYS',
                    label: 'Deleted file grace period',
                    description: 'How many days the bytes behind a deleted file are kept before collection, and how '
                        + 'long an owner can still be offered them back. 0 collects on the next sweep.',
                    unit: 'days',
                    sweep: { kind: 'gc', label: 'Garbage collection' },
                },
            ],
        },
    ];

    //------------------------------------------------------------------------------------------------------------------
    // Data
    //------------------------------------------------------------------------------------------------------------------

    const settings = useAdminSettingsStore();

    onMounted(() => { void settings.load(); });

    interface RenderedField extends FieldPresentation
    {
        entry : AdminSettingEntry;
    }

    const groups = computed(() => groupLayout
        .map((group) => ({
            heading: group.heading,
            fields: group.keys
                .map((field) =>
                {
                    const entry = settings.entries.find((candidate) => candidate.key === field.key);
                    return entry === undefined ? null : { ...field, entry };
                })
                .filter((field) : field is RenderedField => field !== null),
        }))
        .filter((group) => group.fields.length > 0));
</script>

<!--------------------------------------------------------------------------------------------------------------------->
