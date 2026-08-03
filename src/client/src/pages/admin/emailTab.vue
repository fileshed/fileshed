<!----------------------------------------------------------------------------------------------------------------------
  -- Admin Email Tab
  --
  -- Outgoing mail: the SMTP settings (every one applies to the next email, no restart -- the password is
  -- write-only and stored sealed), the boot-frozen verification requirement, and the test-send that proves the
  -- plumbing against the settings as they stand right now.
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
                />
            </section>

            <section class="flex flex-col gap-3">
                <h2 class="text-lg font-semibold text-highlighted">
                    Test
                </h2>
                <div
                    class="flex flex-col items-start gap-3 rounded-lg border border-default p-4 sm:flex-row
                        sm:items-center sm:justify-between sm:gap-4"
                >
                    <div>
                        <h3 class="font-medium text-default">
                            Send a test email
                        </h3>
                        <p class="mt-1 text-sm text-muted">
                            Sends to your own address with the settings above, exactly as a password reset would.
                        </p>
                    </div>
                    <UButton
                        label="Send test email"
                        icon="i-lucide-send"
                        :loading="sending"
                        @click="sendTest"
                    />
                </div>
            </section>
        </template>
    </div>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';
    import { useToast } from '@nuxt/ui/composables';

    import type { AdminSettingEntry, AdminSettingKey } from '@fileshed/core';

    // Stores
    import { useAdminSettingsStore } from '../../stores/adminSettings.ts';

    // Resource Access
    import { sendTestEmail } from '../../resource-access/admin.ts';

    // Components
    import RestartBanner from '../../components/admin/restartBanner.vue';
    import SettingField from '../../components/admin/settingField.vue';

    // Utils
    import { useRunWithToast } from '../../utils/runWithToast.ts';

    //------------------------------------------------------------------------------------------------------------------
    // Presentation
    //------------------------------------------------------------------------------------------------------------------

    interface FieldPresentation
    {
        key : AdminSettingKey;
        label : string;
        description : string;
    }

    const groupLayout : { heading : string; keys : FieldPresentation[] }[] = [
        {
            heading: 'SMTP server',
            keys: [
                {
                    key: 'SMTP_HOST',
                    label: 'Host',
                    description: 'The SMTP server to send through. Leaving it unset turns outgoing email off.',
                },
                {
                    key: 'SMTP_PORT',
                    label: 'Port',
                    description: 'Usually 587 (STARTTLS) or 465 (TLS).',
                },
                {
                    key: 'SMTP_SECURE',
                    label: 'Use TLS from the first byte',
                    description: 'On for port 465 (implicit TLS); off for 587, where the connection upgrades via '
                        + 'STARTTLS.',
                },
                {
                    key: 'SMTP_USER',
                    label: 'Username',
                    description: 'Leave unset for servers that take unauthenticated mail.',
                },
                {
                    key: 'SMTP_PASSWORD',
                    label: 'Password',
                    description: 'Stored encrypted; shown only as its last characters. Entering a value replaces it.',
                },
                {
                    key: 'SMTP_FROM',
                    label: 'From address',
                    description: 'The sender on every outgoing email, e.g. shed@example.com. Required for email '
                        + 'to be on.',
                },
            ],
        },
        {
            heading: 'Accounts',
            keys: [
                {
                    key: 'EMAIL_VERIFICATION_REQUIRED',
                    label: 'Require email verification',
                    description: 'New accounts must verify their address before signing in. Needs working SMTP.',
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

    //------------------------------------------------------------------------------------------------------------------
    // Test send
    //------------------------------------------------------------------------------------------------------------------

    const { runMutation } = useRunWithToast();
    const toast = useToast();

    const sending = ref(false);

    function sendTest() : void
    {
        void runMutation(async () =>
        {
            const { to } = await sendTestEmail();
            toast.add({ title: `Test email sent to ${ to }.`, color: 'success' });
        }, sending);
    }
</script>

<!--------------------------------------------------------------------------------------------------------------------->
