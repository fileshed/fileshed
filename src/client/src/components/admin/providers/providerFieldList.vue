<!----------------------------------------------------------------------------------------------------------------------
  -- Provider Field List
  --
  -- The rendering shared by every provider component: a list of setting-field descriptors resolved against the
  -- admin settings store. A key the server does not know simply does not render -- the safe failure for a client
  -- older than its server.
  --------------------------------------------------------------------------------------------------------------------->

<template>
    <template v-for="field of resolved" :key="field.entry.key">
        <SettingField
            :entry="field.entry"
            :label="field.label"
            :description="field.description"
        />
    </template>
</template>

<!--------------------------------------------------------------------------------------------------------------------->

<script setup lang="ts">
    import { computed } from 'vue';

    import type { AdminSettingEntry, AdminSettingKey } from '@fileshed/core';

    // Stores
    import { useAdminSettingsStore } from '../../../stores/adminSettings.ts';

    // Components
    import SettingField from '../settingField.vue';

    //------------------------------------------------------------------------------------------------------------------

    export interface ProviderFieldDescriptor
    {
        key : AdminSettingKey;
        label : string;
        description : string;
    }

    const props = defineProps<{ fields : ProviderFieldDescriptor[] }>();

    const settings = useAdminSettingsStore();

    const resolved = computed(() => props.fields
        .map((field) =>
        {
            const entry = settings.entries.find((candidate) => candidate.key === field.key);
            return entry === undefined ? null : { ...field, entry };
        })
        .filter((field) : field is ProviderFieldDescriptor & { entry : AdminSettingEntry } => field !== null));
</script>

<!--------------------------------------------------------------------------------------------------------------------->
